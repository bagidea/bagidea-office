// BagIdea Office — external channel connectors (zero-dep).
// The office answers the outside world through the Director (main):
//   • Telegram — long-poll getUpdates (works behind any NAT, no public URL)
//   • Discord  — real gateway connection (hand-rolled WSS client)
//   • LINE     — Messaging API webhook (POST /channels/line/webhook — needs a
//                public HTTPS URL, e.g. a cloudflared tunnel; replies are
//                PUSHed so slow agent runs never outlive a reply token)
//   • Slack / WhatsApp / Messenger / Feishu-Lark — webhooks of the same shape
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

// ---- Feishu / Lark helpers ---------------------------------------------------
// With an Encrypt Key set, an event arrives as {"encrypt": base64(iv ‖ AES-256-CBC)}
// under key = SHA-256(Encrypt Key). (Open Platform docs: "Encrypt Key encryption".)
function feishuDecrypt(encryptKey, b64) {
  const buf = Buffer.from(String(b64), "base64");
  if (buf.length < 32 || buf.length % 16) throw new Error("bad ciphertext");
  const key = crypto.createHash("sha256").update(String(encryptKey)).digest();
  const d = crypto.createDecipheriv("aes-256-cbc", key, buf.subarray(0, 16));
  return Buffer.concat([d.update(buf.subarray(16)), d.final()]).toString("utf8");
}
function safeEq(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// ---- connectors --------------------------------------------------------------
module.exports = function initChannels(ctx) {
  // ctx.jreq: a test seam for the outbound HTTPS calls (Feishu uses it).
  const http_ = ctx.jreq || jreq;
  // ctx: getConfig() → reg.channels, onMessage(channel, from, text, reply), log(s)
  const state = { telegram: "off", discord: "off", line: "off",
    slack: "off", whatsapp: "off", messenger: "off", feishu: "off" };
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
            // A tap on an approval button arrives as a callback_query, not a message.
            const cq = u.callback_query;
            if (cq && cq.data && typeof ctx.onCallback === "function") {
              if (cfg.chat && cq.message && String(cq.message.chat.id) !== String(cfg.chat)) continue;
              ctx.onCallback("telegram", cq.data, (answer) => {
                jreq("POST", "api.telegram.org", `/bot${cfg.token}/answerCallbackQuery`, null,
                  { callback_query_id: cq.id, text: String(answer || "").slice(0, 200) }, () => {});
                // and settle the card so it can't be tapped twice
                if (cq.message) jreq("POST", "api.telegram.org", `/bot${cfg.token}/editMessageReplyMarkup`, null,
                  { chat_id: cq.message.chat.id, message_id: cq.message.message_id, reply_markup: { inline_keyboard: [] } }, () => {});
              });
              continue;
            }
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
  // `item` (optional) is an inbox item: when it carries options, the last text
  // part gets an inline keyboard so the owner can answer with one tap.
  function sendTelegram(token, chatId, text, item) {
    const parts = chunk(String(text), 3900);
    const keyboard = item && Array.isArray(item.options) && item.link && String(item.link).startsWith("approval:")
      ? { inline_keyboard: [item.options.map((o) => ({ text: o.label || o.value,
          callback_data: "apv:" + String(item.link).slice(9) + ":" + o.value }))] }
      : null;
    // Any preview image the message references rides along as a real photo
    // (after the text, so the caption context arrives first).
    const photos = imagePaths(text);
    const sendPhotos = (i) => { if (i < photos.length) sendTelegramPhoto(token, chatId, photos[i], () => sendPhotos(i + 1)); };
    const sendNext = (i) => {
      if (i >= parts.length) return sendPhotos(0);
      const msg = { chat_id: chatId, text: parts[i] };
      if (keyboard && i === parts.length - 1) msg.reply_markup = keyboard;
      jreq("POST", "api.telegram.org", `/bot${token}/sendMessage`, null, msg, () => sendNext(i + 1));
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

  // ---- Feishu / Lark (飞书): event-subscription webhook in, im/v1/messages out.
  // A custom app with the Bot capability subscribes to `im.message.receive_v1`
  // and posts it to /channels/feishu/webhook through a public HTTPS tunnel
  // (same as LINE). Replies are sent with a tenant_access_token, which the
  // platform issues for ~2 h from the app id + secret — cached here and fetched
  // again shortly before it runs out. Feishu (open.feishu.cn) and Lark
  // (open.larksuite.com) speak the same protocol on different hosts.
  const FEISHU_HOSTS = { feishu: "open.feishu.cn", lark: "open.larksuite.com" };
  const fsHost = (cfg) => FEISHU_HOSTS[cfg.domain] || FEISHU_HOSTS.feishu;
  const fsReady = (cfg) => !!(cfg && cfg.enabled && cfg.appId && cfg.secret);
  let fsTok = null;         // { key, token, exp }
  let fsTokWait = null;     // { key, cbs } — one fetch in flight, however many senders ask
  let fsCredBad = false;    // the last token fetch failed: an arriving event must not paint the light green
  let lastFeishu = null;    // chat_id of the last sender, for relay()
  const fsSeen = new Map(); // message_id / event_id → ts (Feishu can push one message twice)
  function feishuToken(cfg, cb) {
    const key = fsHost(cfg) + "|" + cfg.appId + "|" + cfg.secret;
    if (fsTok && fsTok.key === key && fsTok.exp > Date.now()) return cb(null, fsTok.token);
    if (fsTokWait && fsTokWait.key === key) return void fsTokWait.cbs.push(cb);
    const wait = fsTokWait = { key, cbs: [cb] };
    http_("POST", fsHost(cfg), "/open-apis/auth/v3/tenant_access_token/internal", null,
      { app_id: cfg.appId, app_secret: cfg.secret }, (e, j) => {
        if (fsTokWait === wait) fsTokWait = null;
        let err = null, tok = null;
        if (e || !j) err = (e && e.message) || "no response";
        else if (j.code !== 0 || !j.tenant_access_token) err = j.msg || ("code " + j.code);
        else {
          tok = j.tenant_access_token;
          // Renew five minutes early; never trust an expiry under a minute.
          fsTok = { key, token: tok, exp: Date.now() + Math.max(60, (Number(j.expire) || 7200) - 300) * 1000 };
        }
        fsCredBad = !!err;
        if (err) { state.feishu = "error: " + String(err).slice(0, 80); log("feishu token: " + err); }
        else if (String(state.feishu).startsWith("error")) state.feishu = "ready — waiting for events";
        for (const c of wait.cbs) { try { c(err, tok); } catch {} }
      }, 15000);
  }
  // `to` is a chat_id (oc_…) or an open_id (ou_…); parts go out in order.
  function sendFeishu(cfg, to, text, retried) {
    if (!to) return;
    const idType = String(to).startsWith("ou_") ? "open_id" : "chat_id";
    feishuToken(cfg, (err, tok) => {
      if (err) return;
      const parts = chunk(String(text), 4000);
      const next = (i) => {
        if (i >= parts.length) return;
        http_("POST", fsHost(cfg), "/open-apis/im/v1/messages?receive_id_type=" + idType,
          { authorization: "Bearer " + tok },
          { receive_id: to, msg_type: "text", content: JSON.stringify({ text: parts[i] }) },
          (e, j) => {
            // 99991663 / 99991665: the tenant token expired early or was revoked — fetch a fresh one, once.
            if (j && [99991663, 99991665].includes(j.code) && !retried) {
              fsTok = null;
              return sendFeishu(cfg, to, parts.slice(i).join(""), true);
            }
            if (e || (j && j.code)) log("feishu send: " + (e ? e.message : j.code + " " + (j.msg || "")));
            next(i + 1);
          });
      };
      next(0);
    });
  }
  function feishuWebhook(req, res, rawBody) {
    const cfg = (ctx.getConfig().feishu) || {};
    if (!fsReady(cfg)) { res.writeHead(404); return res.end(); }
    // An unauthenticated webhook would let anyone who finds the tunnel URL give
    // the office orders, so one of the two proofs Feishu offers is REQUIRED.
    if (!cfg.verify && !cfg.encryptKey) {
      state.feishu = "error: set the Verification Token or an Encrypt Key";
      res.writeHead(403); return res.end();
    }
    const raw = rawBody.toString("utf8");
    let j; try { j = JSON.parse(raw); } catch { res.writeHead(400); return res.end(); }
    if (cfg.encryptKey) {
      // With an Encrypt Key the platform signs the request and encrypts the body.
      const sig = req.headers["x-lark-signature"];
      if (sig) {
        const mine = crypto.createHash("sha256").update(
          String(req.headers["x-lark-request-timestamp"] || "") + String(req.headers["x-lark-request-nonce"] || "") +
          cfg.encryptKey + raw).digest("hex");
        if (!safeEq(mine, String(sig))) { res.writeHead(403); return res.end(); }
      }
      if (typeof j.encrypt !== "string") { res.writeHead(403); return res.end(); }
      try { j = JSON.parse(feishuDecrypt(cfg.encryptKey, j.encrypt)); }
      catch { state.feishu = "error: Encrypt Key does not match"; res.writeHead(403); return res.end(); }
    } else if (typeof j.encrypt === "string") {
      state.feishu = "error: events are encrypted — enter the Encrypt Key";
      res.writeHead(400); return res.end();
    }
    if (cfg.verify && !safeEq(String((j.header && j.header.token) || j.token || ""), cfg.verify)) {
      res.writeHead(403); return res.end();
    }
    // The one-time Request URL check: echo the challenge as JSON within a second.
    if (j.type === "url_verification") {
      if (!fsCredBad) state.feishu = "on";
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ challenge: j.challenge || "" }));
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end("{}");            // ack fast — Feishu redelivers anything slower than 3 s
    if (!fsCredBad) state.feishu = "on";
    const h = j.header || {};
    if (h.event_type !== "im.message.receive_v1") return;
    const ev = j.event || {}, m = ev.message || {}, sender = ev.sender || {};
    // The platform documents duplicate pushes and says to dedupe on message_id
    // (a redelivery can carry a new event_id); both are remembered.
    const ids = [m.message_id && "m:" + m.message_id, h.event_id && "e:" + h.event_id].filter(Boolean);
    if (ids.some((k) => fsSeen.has(k))) return;
    for (const k of ids) fsSeen.set(k, Date.now());
    if (fsSeen.size > 1000) for (const k of fsSeen.keys()) { fsSeen.delete(k); if (fsSeen.size <= 800) break; }
    if (sender.sender_type && sender.sender_type !== "user") return;   // never answer another bot
    if (m.message_type !== "text" || !m.chat_id) return;
    let text = "";
    try { text = String(JSON.parse(m.content).text || ""); } catch {}
    // In a group the bot is addressed by a mention, which arrives as a placeholder.
    text = text.replace(/@_(?:user_\d+|all)\s*/g, "").trim();
    if (!text) return;
    const openId = (sender.sender_id && sender.sender_id.open_id) || "";
    // Optional allowlist: your own open_id, or one chat's chat_id.
    if (cfg.chat && cfg.chat !== m.chat_id && cfg.chat !== openId) return;
    lastFeishu = m.chat_id;
    const chatId = m.chat_id;
    ctx.onMessage("feishu", cfg.domain === "lark" ? "Lark user" : "Feishu user", text,
      (reply) => sendFeishu(cfg, chatId, reply), () => {});
  }
  // Saving the card checks the credentials at once, so a wrong App Secret shows
  // as an error here rather than as silence after the first message.
  function startFeishu() {
    const cfg = (ctx.getConfig().feishu) || {};
    fsTok = null; fsCredBad = false;
    if (!fsReady(cfg)) { state.feishu = "off"; return; }
    state.feishu = "connecting";
    feishuToken(cfg, (err) => { if (!err && state.feishu === "connecting") state.feishu = "ready — waiting for events"; });
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
  function relay(text, item) {
    const t = String(text);
    if (!t.trim()) return;
    const tg = (ctx.getConfig().telegram) || {};
    if (state.telegram === "on" && tg.token && tg.chat) sendTelegram(tg.token, tg.chat, t, item);
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
    // Feishu: the last chat that spoke — or, before anyone has, the allowlisted id.
    const fs_ = (ctx.getConfig().feishu) || {};
    if (fsReady(fs_) && (lastFeishu || fs_.chat)) sendFeishu(fs_, lastFeishu || fs_.chat, t);
  }

  return {
    restart() { stopAll(); setTimeout(() => { startTelegram(); startDiscord(); startFeishu(); }, 300); },
    lineWebhook,
    slackWebhook,
    whatsappWebhook,
    messengerWebhook,
    feishuWebhook,
    relay,
    status: () => ({ ...state }),
  };
};

// The WSS client doubles as the Gemini Live transport (server.js /live).
module.exports.wsConnect = wsConnect;
module.exports.feishuDecrypt = feishuDecrypt;
