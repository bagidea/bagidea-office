// BagIdea Office — external channel connectors (zero-dep).
// The office answers the outside world through the Director (main):
//   • Telegram — long-poll getUpdates (works behind any NAT, no public URL)
//   • Discord  — real gateway connection (hand-rolled WSS client)
//   • LINE     — Messaging API webhook (POST /channels/line/webhook — needs a
//                public HTTPS URL, e.g. a cloudflared tunnel; replies are
//                PUSHed so slow agent runs never outlive a reply token)
// Config lives in registry.json under reg.channels (edited in ⚙ CONNECT).

const https = require("https");
const tls = require("tls");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// ---- tiny https JSON request ------------------------------------------------
function jreq(method, host, path, headers, body, cb, timeoutMs) {
  const data = body ? Buffer.from(JSON.stringify(body)) : null;
  const req = https.request({
    method, host, path,
    headers: {
      ...(headers || {}),
      ...(data ? { "content-type": "application/json", "content-length": data.length } : {}),
    },
  }, (res) => {
    let out = "";
    res.on("data", (c) => (out += c));
    res.on("end", () => {
      let j = null;
      try { j = JSON.parse(out); } catch {}
      cb(null, j, res.statusCode);
    });
  });
  req.setTimeout(timeoutMs || 65000, () => req.destroy(new Error("timeout")));
  req.on("error", (e) => cb(e));
  if (data) req.write(data);
  req.end();
}

// ---- minimal WebSocket CLIENT (for the Discord gateway) ---------------------
// Client frames must be masked; we speak text frames + ping/pong + close.
function wsConnect(host, path, hooks) {
  const key = crypto.randomBytes(16).toString("base64");
  let handshook = false;
  let buf = Buffer.alloc(0);
  let frag = null;  // continuation-frame accumulator
  const sock = tls.connect(443, host, { servername: host }, () => {
    sock.write(
      `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUpgrade: websocket\r\n` +
      `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\n` +
      `Sec-WebSocket-Version: 13\r\n\r\n`);
  });
  function sendRaw(payload, op) {
    const p = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const mask = crypto.randomBytes(4);
    let head;
    if (p.length < 126) head = Buffer.from([0x80 | op, 0x80 | p.length]);
    else if (p.length < 65536) {
      head = Buffer.alloc(4);
      head[0] = 0x80 | op; head[1] = 0x80 | 126; head.writeUInt16BE(p.length, 2);
    } else {
      head = Buffer.alloc(10);
      head[0] = 0x80 | op; head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(p.length), 2);
    }
    const masked = Buffer.from(p);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    try { sock.write(Buffer.concat([head, mask, masked])); } catch {}
  }
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    if (!handshook) {
      const i = buf.indexOf("\r\n\r\n");
      if (i < 0) return;
      handshook = true;
      buf = buf.slice(i + 4);
      hooks.onOpen && hooks.onOpen();
    }
    for (;;) {
      if (buf.length < 2) return;
      const fin = !!(buf[0] & 0x80);
      const op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (buf.length < off + len) return;
      const payload = buf.slice(off, off + len);
      buf = buf.slice(off + len);
      if (op === 1 || op === 0 || op === 2) {
        // text, continuation, or binary — Gemini Live ships JSON in BINARY
        // frames, so binary payloads decode as utf8 too.
        frag = frag ? Buffer.concat([frag, payload]) : payload;
        if (fin) { const msg = frag.toString("utf8"); frag = null; hooks.onMsg && hooks.onMsg(msg); }
      } else if (op === 9) sendRaw(payload, 10);   // ping → pong
      else if (op === 8) { try { sock.end(); } catch {} return; }
    }
  });
  sock.on("close", () => hooks.onClose && hooks.onClose());
  sock.on("error", () => {});
  return { send: (s) => sendRaw(s, 1), close: () => { try { sock.destroy(); } catch {} } };
}

// ---- connectors --------------------------------------------------------------
module.exports = function initChannels(ctx) {
  // ctx: getConfig() → reg.channels, onMessage(channel, from, text, reply), log(s)
  const state = { telegram: "off", discord: "off", line: "off",
    slack: "off", whatsapp: "off", messenger: "off" };
  // Generation tokens, NOT shared booleans: a restart bumps the generation,
  // and any in-flight long-poll / reconnect from an older generation dies
  // the moment it next checks — a shared "alive" flag resurrected old
  // pollers after a restart (two getUpdates → Telegram 409 Conflict).
  let tgGen = 0, dcGen = 0;
  let dcSock = null, dcBeat = null, dcSeq = null;
  let lastLine = null;  // last LINE sender {token,to} — LINE has no fixed target id

  const log = (s) => ctx.log && ctx.log("[chan] " + s);

  // ---- Telegram: long-poll — the friendliest possible integration.
  function startTelegram() {
    const cfg = (ctx.getConfig().telegram) || {};
    if (!cfg.enabled || !cfg.token) { state.telegram = "off"; return; }
    state.telegram = "connecting";
    const gen = ++tgGen;
    const live = () => gen === tgGen;
    let offset = 0;
    const poll = () => {
      if (!live()) return;
      jreq("GET", "api.telegram.org",
        `/bot${cfg.token}/getUpdates?timeout=50&offset=${offset}`, null, null,
        (e, j) => {
          if (!live()) return;
          if (e || !j) { state.telegram = "error"; return setTimeout(poll, 8000); }
          if (!j.ok) { state.telegram = "error: " + (j.description || "bad token"); return setTimeout(poll, 15000); }
          state.telegram = "on";
          for (const u of j.result || []) {
            offset = u.update_id + 1;
            const m = u.message;
            if (!m || !m.text) continue;
            // Optional allowlist: a chat id pins the office to YOUR chat.
            if (cfg.chat && String(m.chat.id) !== String(cfg.chat)) continue;
            const from = [m.from && m.from.first_name, m.from && m.from.last_name]
              .filter(Boolean).join(" ") || "telegram user";
            const chatId = m.chat.id;
            ctx.onMessage("telegram", from, m.text,
              (reply) => sendTelegram(cfg.token, chatId, reply),
              () => jreq("POST", "api.telegram.org", `/bot${cfg.token}/sendChatAction`,
                null, { chat_id: chatId, action: "typing" }, () => {}));
          }
          setTimeout(poll, 400);
        });
    };
    poll();
    log("telegram poller started");
  }
  // Image paths an agent mentioned in its reply (server-side twin of the
  // overlay's MEDIA_RE, images only). "/uploads/x.png" is a daemon URL, not a
  // disk path — resolve it via ctx.uploadsDir so the bytes can be uploaded.
  function imagePaths(text) {
    const re = /((?:[A-Za-z]:[\\/]|\/(?:uploads|Users|home|Volumes|mnt|media|tmp|data|opt|srv|var|root|workspace)\/)[^\r\n"'`<>|?*]+?\.(?:png|jpe?g|gif|webp|bmp))/gi;
    const out = [];
    let m;
    while ((m = re.exec(String(text))) && out.length < 3) {
      let p = m[1];
      if (/^\/uploads\//.test(p) && ctx.uploadsDir) p = path.join(ctx.uploadsDir, p.slice("/uploads/".length));
      try {
        if (fs.existsSync(p) && fs.statSync(p).size < 10 * 1048576 && !out.includes(p)) out.push(p);
      } catch {}
    }
    return out;
  }
  // Telegram's URL form of sendPhoto needs a PUBLIC url — ours are localhost —
  // so upload the actual bytes as multipart/form-data.
  function sendTelegramPhoto(token, chatId, file, cb) {
    let buf;
    try { buf = fs.readFileSync(file); } catch { return cb && cb(); }
    const name = file.replace(/^.*[\\/]/, "");
    const ext = (name.match(/\.(\w+)$/) || [, "png"])[1].toLowerCase();
    const boundary = "----bagidea" + Date.now();
    const head = Buffer.from(
      `--${boundary}\r\ncontent-disposition: form-data; name="chat_id"\r\n\r\n${chatId}\r\n` +
      `--${boundary}\r\ncontent-disposition: form-data; name="photo"; filename="${name}"\r\n` +
      `content-type: image/${ext === "jpg" ? "jpeg" : ext}\r\n\r\n`);
    const body = Buffer.concat([head, buf, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const r = https.request({ host: "api.telegram.org", path: `/bot${token}/sendPhoto`, method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=" + boundary, "content-length": body.length } },
      (res) => { res.resume(); res.on("end", () => cb && cb()); });
    r.on("error", () => cb && cb());
    r.end(body);
  }
  function sendTelegram(token, chatId, text) {
    const parts = chunk(String(text), 3900);
    // Any preview image the message references rides along as a real photo
    // (after the text, so the caption context arrives first).
    const photos = imagePaths(text);
    const sendPhotos = (i) => { if (i < photos.length) sendTelegramPhoto(token, chatId, photos[i], () => sendPhotos(i + 1)); };
    const sendNext = (i) => {
      if (i >= parts.length) return sendPhotos(0);
      jreq("POST", "api.telegram.org", `/bot${token}/sendMessage`, null,
        { chat_id: chatId, text: parts[i] }, () => sendNext(i + 1));
    };
    sendNext(0);
  }

  // ---- Discord: a real gateway session (IDENTIFY → MESSAGE_CREATE).
  function startDiscord() {
    const cfg = (ctx.getConfig().discord) || {};
    if (!(cfg.enabled && cfg.token)) { state.discord = "off"; return; }
    state.discord = "connecting";
    const gen = ++dcGen;
    const live = () => gen === dcGen;
    const sock = wsConnect("gateway.discord.gg", "/?v=10&encoding=json", {
      onMsg: (raw) => {
        if (!live()) return;
        let m;
        try { m = JSON.parse(raw); } catch { return; }
        if (m.s) dcSeq = m.s;
        if (m.op === 10) {           // HELLO → heartbeat + identify
          clearInterval(dcBeat);
          dcBeat = setInterval(() =>
            sock.send(JSON.stringify({ op: 1, d: dcSeq })), m.d.heartbeat_interval || 41250);
          sock.send(JSON.stringify({ op: 2, d: {
            token: cfg.token,
            // GUILD_MESSAGES + DIRECT_MESSAGES + MESSAGE_CONTENT
            intents: (1 << 9) | (1 << 12) | (1 << 15),
            properties: { os: "windows", browser: "bagidea-office", device: "bagidea-office" },
          } }));
        } else if (m.op === 0 && m.t === "READY") {
          state.discord = "on";
          log("discord ready as " + (m.d.user && m.d.user.username));
        } else if (m.op === 0 && m.t === "MESSAGE_CREATE") {
          const d = m.d;
          if (!d || !d.content || (d.author && d.author.bot)) return;
          if (cfg.channel && String(d.channel_id) !== String(cfg.channel)) return;
          const from = (d.author && (d.author.global_name || d.author.username)) || "discord user";
          ctx.onMessage("discord", from, d.content,
            (reply) => sendDiscord(cfg.token, d.channel_id, reply),
            () => jreq("POST", "discord.com", `/api/v10/channels/${d.channel_id}/typing`,
              { authorization: "Bot " + cfg.token }, null, () => {}));
        } else if (m.op === 9) {      // invalid session → re-identify fresh
          try { sock.close(); } catch {}
        }
      },
      onClose: () => {
        clearInterval(dcBeat);
        if (live()) {
          state.discord = "reconnecting";
          setTimeout(() => { if (live()) startDiscord(); }, 6000);
        } else state.discord = "off";
      },
    });
    dcSock = sock;
  }
  function sendDiscord(token, channelId, text) {
    const parts = chunk(String(text), 1900);
    const sendNext = (i) => {
      if (i >= parts.length) return;
      jreq("POST", "discord.com", `/api/v10/channels/${channelId}/messages`,
        { authorization: "Bot " + token }, { content: parts[i] }, () => sendNext(i + 1));
    };
    sendNext(0);
  }

  // ---- LINE: webhook in, push out (reply tokens die in a minute — agents
  // think longer than that, so we push to the user id instead).
  function lineWebhook(req, res, rawBody) {
    const cfg = (ctx.getConfig().line) || {};
    if (!cfg.enabled || !cfg.token) { res.writeHead(404); return res.end(); }
    if (cfg.secret) {
      const sig = crypto.createHmac("sha256", cfg.secret).update(rawBody).digest("base64");
      if (sig !== req.headers["x-line-signature"]) { res.writeHead(403); return res.end(); }
    }
    res.writeHead(200);
    res.end("ok");           // ack fast — LINE retries slow webhooks
    state.line = "on";
    let j;
    try { j = JSON.parse(rawBody.toString("utf8")); } catch { return; }
    for (const ev of j.events || []) {
      if (ev.type !== "message" || !ev.message || ev.message.type !== "text") continue;
      const to = ev.source && (ev.source.userId || ev.source.groupId);
      if (!to) continue;
      lastLine = { token: cfg.token, to };  // remember so relay() can push here
      ctx.onMessage("line", "LINE user", ev.message.text, (reply) => {
        for (const part of chunk(String(reply), 4900))
          jreq("POST", "api.line.me", "/v2/bot/message/push",
            { authorization: "Bearer " + cfg.token },
            { to, messages: [{ type: "text", text: part }] }, () => {});
      },
      () => jreq("POST", "api.line.me", "/v2/bot/chat/loading/start",
        { authorization: "Bearer " + cfg.token }, { chatId: to, loadingSeconds: 20 }, () => {}));
    }
  }

  // ---- Slack: Events API webhook in, chat.postMessage out. Needs a public
  // HTTPS URL (same cloudflared tunnel as LINE) set as the app's Request URL.
  let lastSlack = null;   // {token, channel} for relay()
  function slackWebhook(req, res, rawBody) {
    const cfg = (ctx.getConfig().slack) || {};
    if (!cfg.enabled || !cfg.token) { res.writeHead(404); return res.end(); }
    let j; try { j = JSON.parse(rawBody.toString("utf8")); } catch { res.writeHead(400); return res.end(); }
    // Slack's one-time URL verification handshake.
    if (j.type === "url_verification") {
      res.writeHead(200, { "content-type": "text/plain" }); return res.end(j.challenge || "");
    }
    if (cfg.secret) {  // verify v0 signature
      const ts = req.headers["x-slack-request-timestamp"] || "";
      const base = "v0:" + ts + ":" + rawBody.toString("utf8");
      const mine = "v0=" + crypto.createHmac("sha256", cfg.secret).update(base).digest("hex");
      if (mine !== req.headers["x-slack-signature"]) { res.writeHead(403); return res.end(); }
    }
    res.writeHead(200); res.end("ok");   // ack fast — Slack retries slow webhooks
    state.slack = "on";
    const ev = j.event;
    if (!ev || ev.type !== "message" || ev.bot_id || ev.subtype || !ev.text) return;
    lastSlack = { token: cfg.token, channel: ev.channel };
    ctx.onMessage("slack", "Slack user", ev.text,
      (reply) => sendSlack(cfg.token, ev.channel, reply), () => {});
  }
  function sendSlack(token, channel, text) {
    for (const part of chunk(String(text), 3800))
      jreq("POST", "slack.com", "/api/chat.postMessage",
        { authorization: "Bearer " + token }, { channel, text: part }, () => {});
  }

  // ---- Meta (WhatsApp Cloud API + Messenger): both are Graph API webhooks with
  // the same GET verify handshake (hub.challenge) and a POST event body.
  let lastWa = null, lastMsgr = null;
  function metaVerify(req, res, cfg) {
    const u = new URL(req.url, "http://x");
    if (u.searchParams.get("hub.mode") === "subscribe" &&
        u.searchParams.get("hub.verify_token") === (cfg.verify || "")) {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(u.searchParams.get("hub.challenge") || ""); return true;
    }
    res.writeHead(403); res.end(); return true;
  }
  function whatsappWebhook(req, res, rawBody) {
    const cfg = (ctx.getConfig().whatsapp) || {};
    if (!cfg.enabled) { res.writeHead(404); return res.end(); }
    if (req.method === "GET") return metaVerify(req, res, cfg);
    res.writeHead(200); res.end("ok");
    state.whatsapp = "on";
    let j; try { j = JSON.parse(rawBody.toString("utf8")); } catch { return; }
    for (const entry of j.entry || [])
      for (const ch of entry.changes || []) {
        const v = ch.value || {};
        for (const m of v.messages || []) {
          if (!m.text || !m.text.body) continue;
          const to = m.from;
          lastWa = { token: cfg.token, phone: cfg.phone, to };
          ctx.onMessage("whatsapp", "WhatsApp user", m.text.body,
            (reply) => sendWhatsApp(cfg.token, cfg.phone, to, reply), () => {});
        }
      }
  }
  function sendWhatsApp(token, phoneId, to, text) {
    for (const part of chunk(String(text), 3800))
      jreq("POST", "graph.facebook.com", `/v22.0/${phoneId}/messages`,
        { authorization: "Bearer " + token },
        { messaging_product: "whatsapp", to, type: "text", text: { body: part } }, () => {});
  }
  function messengerWebhook(req, res, rawBody) {
    const cfg = (ctx.getConfig().messenger) || {};
    if (!cfg.enabled) { res.writeHead(404); return res.end(); }
    if (req.method === "GET") return metaVerify(req, res, cfg);
    res.writeHead(200); res.end("ok");
    state.messenger = "on";
    let j; try { j = JSON.parse(rawBody.toString("utf8")); } catch { return; }
    for (const entry of j.entry || [])
      for (const ev of entry.messaging || []) {
        if (!ev.message || !ev.message.text || (ev.message.is_echo)) continue;
        const to = ev.sender && ev.sender.id;
        if (!to) continue;
        lastMsgr = { token: cfg.token, to };
        ctx.onMessage("messenger", "Messenger user", ev.message.text,
          (reply) => sendMessenger(cfg.token, to, reply), () => {});
      }
  }
  function sendMessenger(token, to, text) {
    for (const part of chunk(String(text), 1900))
      jreq("POST", "graph.facebook.com", `/v22.0/me/messages?access_token=${encodeURIComponent(token)}`,
        null, { recipient: { id: to }, messaging_type: "RESPONSE", message: { text: part } }, () => {});
  }

  function chunk(s, n) {
    const out = [];
    for (let i = 0; i < s.length && out.length < 5; i += n) out.push(s.slice(i, i + n));
    return out.length ? out : [""];
  }

  function stopAll() {
    tgGen++;   // orphan every in-flight poll — they die on next check
    dcGen++;
    clearInterval(dcBeat);
    if (dcSock) { try { dcSock.close(); } catch {} dcSock = null; }
  }

  // Push an office-originated line OUT to every connected channel that has a
  // known target — so a conversation held at the CEO seat in the app also
  // mirrors to Telegram/Discord/LINE. No-op for a channel without a target.
  function relay(text) {
    const t = String(text);
    if (!t.trim()) return;
    const tg = (ctx.getConfig().telegram) || {};
    if (state.telegram === "on" && tg.token && tg.chat) sendTelegram(tg.token, tg.chat, t);
    const dc = (ctx.getConfig().discord) || {};
    if (state.discord === "on" && dc.token && dc.channel) sendDiscord(dc.token, dc.channel, t);
    if (lastLine && lastLine.token) {
      for (const part of chunk(t, 4900))
        jreq("POST", "api.line.me", "/v2/bot/message/push",
          { authorization: "Bearer " + lastLine.token },
          { to: lastLine.to, messages: [{ type: "text", text: part }] }, () => {});
    }
    if (lastSlack && lastSlack.token) sendSlack(lastSlack.token, lastSlack.channel, t);
    if (lastWa && lastWa.token) sendWhatsApp(lastWa.token, lastWa.phone, lastWa.to, t);
    if (lastMsgr && lastMsgr.token) sendMessenger(lastMsgr.token, lastMsgr.to, t);
  }

  return {
    restart() { stopAll(); setTimeout(() => { startTelegram(); startDiscord(); }, 300); },
    lineWebhook,
    slackWebhook,
    whatsappWebhook,
    messengerWebhook,
    relay,
    status: () => ({ ...state }),
  };
};

// The WSS client doubles as the Gemini Live transport (server.js /live).
module.exports.wsConnect = wsConnect;
