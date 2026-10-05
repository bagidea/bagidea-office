// Feishu / Lark channel (issue #65) — the webhook contract, checked against
// payloads built from the Open Platform documentation, with the outbound HTTPS
// calls replaced by a recorder. No network, no daemon, no real app.
//
//   in : POST /channels/feishu/webhook  (url_verification · im.message.receive_v1,
//        plaintext or {"encrypt": …} under an Encrypt Key, optionally signed)
//   out: tenant_access_token/internal → im/v1/messages
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const initChannels = require("../channels");

const tick = (ms = 0) => new Promise((r) => (ms ? setTimeout(r, ms) : setImmediate(r)));

// A recorder standing in for the HTTPS client: answers the token call and the
// send call the way the platform does, asynchronously.
function rig(feishu, opts = {}) {
  const calls = [], got = [], logs = [];
  let tokenN = 0;
  const cfg = { feishu: { enabled: true, appId: "cli_test", secret: "app-secret", verify: "vtok", ...feishu } };
  const ch = initChannels({
    getConfig: () => cfg,
    log: (s) => logs.push(s),
    onMessage: (channel, from, text, reply) => got.push({ channel, from, text, reply }),
    jreq(method, host, p, headers, body, cb) {
      calls.push({ method, host, path: p, headers: headers || {}, body });
      setImmediate(() => {
        if (p.includes("/tenant_access_token/")) {
          if (opts.badSecret) return cb(null, { code: 10014, msg: "app secret invalid" }, 200);
          return cb(null, { code: 0, tenant_access_token: "t-" + (++tokenN), expire: 7200 }, 200);
        }
        if (opts.rejectFirstSend && calls.filter((c) => c.path.includes("/im/v1/messages")).length === 1)
          return cb(null, { code: 99991663, msg: "Invalid access token" }, 400);
        cb(null, { code: 0, data: {} }, 200);
      });
    },
  });
  const post = (payload, headers = {}) => {
    const out = { status: 0, body: "" };
    const res = { writeHead(s) { out.status = s; }, end(b) { out.body = b || ""; } };
    const raw = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload));
    ch.feishuWebhook({ headers, url: "/channels/feishu/webhook", method: "POST" }, res, raw);
    return out;
  };
  const sends = () => calls.filter((c) => c.path.includes("/im/v1/messages"));
  const tokens = () => calls.filter((c) => c.path.includes("/tenant_access_token/"));
  return { ch, cfg, calls, got, logs, post, sends, tokens };
}

let seq = 0;
function message(text, over = {}) {
  return {
    schema: "2.0",
    header: { event_id: over.eventId || "ev-" + (++seq), event_type: over.type || "im.message.receive_v1",
      token: over.token === undefined ? "vtok" : over.token, app_id: "cli_test", tenant_key: "tk" },
    event: {
      sender: { sender_id: { open_id: over.openId || "ou_owner" }, sender_type: over.senderType || "user" },
      message: { message_id: over.messageId || "om_" + seq, chat_id: over.chatId || "oc_chat1", chat_type: "p2p",
        message_type: over.messageType || "text", content: JSON.stringify({ text }) },
    },
  };
}
// The documented scheme: key = SHA-256(Encrypt Key), body = base64(iv ‖ AES-256-CBC(json)).
function encrypt(encryptKey, obj) {
  const key = crypto.createHash("sha256").update(encryptKey).digest(), iv = crypto.randomBytes(16);
  const c = crypto.createCipheriv("aes-256-cbc", key, iv);
  return JSON.stringify({ encrypt: Buffer.concat([iv, c.update(JSON.stringify(obj), "utf8"), c.final()]).toString("base64") });
}
function sign(encryptKey, raw, ts = "1700000000", nonce = "n1") {
  return { "x-lark-request-timestamp": ts, "x-lark-request-nonce": nonce,
    "x-lark-signature": crypto.createHash("sha256").update(ts + nonce + encryptKey + raw).digest("hex") };
}

test("off until it is enabled and has an app id and secret", () => {
  for (const off of [{ enabled: false }, { appId: "" }, { secret: "" }]) {
    const r = rig(off);
    assert.equal(r.post(message("hi")).status, 404);
    assert.equal(r.got.length, 0);
  }
});

test("a webhook with neither a Verification Token nor an Encrypt Key is refused", () => {
  const r = rig({ verify: "", encryptKey: "" });
  assert.equal(r.post(message("do something")).status, 403);
  assert.equal(r.got.length, 0, "an unauthenticated message never becomes an order");
  assert.match(r.ch.status().feishu, /^error: set the Verification Token or an Encrypt Key/);
});

test("the Request URL check echoes the challenge as JSON — and only for the right token", () => {
  const r = rig();
  const ok = r.post({ challenge: "abc123", token: "vtok", type: "url_verification" });
  assert.equal(ok.status, 200);
  assert.deepEqual(JSON.parse(ok.body), { challenge: "abc123" });
  assert.equal(r.ch.status().feishu, "on");
  assert.equal(r.post({ challenge: "abc123", token: "someone-else", type: "url_verification" }).status, 403);
});

test("a text message becomes an order, and the reply goes back to that chat with a tenant token", async () => {
  const r = rig();
  assert.equal(r.post(message("สร้างหน้า landing ให้หน่อย")).status, 200);
  assert.equal(r.got.length, 1);
  assert.deepEqual([r.got[0].channel, r.got[0].from, r.got[0].text], ["feishu", "Feishu user", "สร้างหน้า landing ให้หน่อย"]);
  r.got[0].reply("ได้ครับ");
  await tick(); await tick(); await tick();
  assert.equal(r.tokens().length, 1);
  assert.deepEqual([r.tokens()[0].host, r.tokens()[0].path], ["open.feishu.cn", "/open-apis/auth/v3/tenant_access_token/internal"]);
  assert.deepEqual(r.tokens()[0].body, { app_id: "cli_test", app_secret: "app-secret" });
  const s = r.sends();
  assert.equal(s.length, 1);
  assert.equal(s[0].host, "open.feishu.cn");
  assert.equal(s[0].path, "/open-apis/im/v1/messages?receive_id_type=chat_id");
  assert.equal(s[0].headers.authorization, "Bearer t-1");
  assert.deepEqual(s[0].body, { receive_id: "oc_chat1", msg_type: "text", content: JSON.stringify({ text: "ได้ครับ" }) });
});

test("Lark is the same protocol on its own host", async () => {
  const r = rig({ domain: "lark" });
  r.post(message("hello"));
  assert.equal(r.got[0].from, "Lark user");
  r.got[0].reply("hi");
  await tick(); await tick(); await tick();
  assert.ok(r.calls.every((c) => c.host === "open.larksuite.com"), JSON.stringify(r.calls.map((c) => c.host)));
});

test("the tenant token is fetched once and shared — by later replies and by concurrent ones", async () => {
  const r = rig();
  r.post(message("one")); r.post(message("two"));
  r.got[0].reply("a"); r.got[1].reply("b");            // both ask before the first fetch returns
  await tick(); await tick(); await tick();
  assert.equal(r.tokens().length, 1, "one fetch in flight serves both");
  assert.equal(r.sends().length, 2);
  r.post(message("three")); r.got[2].reply("c");
  await tick(); await tick(); await tick();
  assert.equal(r.tokens().length, 1, "cached for the next reply");
  assert.deepEqual(r.sends().map((s) => s.headers.authorization), ["Bearer t-1", "Bearer t-1", "Bearer t-1"]);
});

test("a token the platform rejects is replaced once and the message is sent again", async () => {
  const r = rig({}, { rejectFirstSend: true });
  r.post(message("go")); r.got[0].reply("done");
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(r.tokens().length, 2, "a fresh token was fetched");
  const s = r.sends();
  assert.equal(s.length, 2);
  assert.deepEqual(s.map((x) => x.headers.authorization), ["Bearer t-1", "Bearer t-2"]);
  assert.equal(JSON.parse(s[1].body.content).text, "done", "the same text, not lost and not doubled");
});

test("a long reply goes out in parts, in order", async () => {
  const r = rig();
  r.post(message("report")); r.got[0].reply("A".repeat(4000) + "B".repeat(4000) + "C".repeat(10));
  for (let i = 0; i < 8; i++) await tick();
  const texts = r.sends().map((s) => JSON.parse(s.body.content).text);
  assert.deepEqual(texts.map((t) => t[0] + t.length), ["A4000", "B4000", "C10"]);
});

test("with an Encrypt Key: the body is decrypted, the signature is checked, plaintext is refused", () => {
  const KEY = "my-encrypt-key";
  const r = rig({ encryptKey: KEY });
  const raw = encrypt(KEY, message("encrypted order"));
  assert.equal(r.post(raw, sign(KEY, raw)).status, 200);
  assert.equal(r.got.length, 1);
  assert.equal(r.got[0].text, "encrypted order");

  const raw2 = encrypt(KEY, message("tampered"));
  assert.equal(r.post(raw2, { ...sign(KEY, raw2), "x-lark-signature": "0".repeat(64) }).status, 403, "bad signature");
  assert.equal(r.post(message("plaintext with a key set")).status, 403, "a plaintext event is not from this subscription");
  assert.equal(r.got.length, 1, "neither became an order");

  // the Request URL check is encrypted too
  const ch = r.post(encrypt(KEY, { challenge: "c-9", token: "vtok", type: "url_verification" }));
  assert.deepEqual(JSON.parse(ch.body), { challenge: "c-9" });
});

test("a wrong Encrypt Key says so in the status instead of failing silently", () => {
  const r = rig({ encryptKey: "the-right-key" });
  assert.equal(r.post(encrypt("another-key", message("x"))).status, 403);
  assert.match(r.ch.status().feishu, /^error: Encrypt Key does not match/);
  const plain = rig({ encryptKey: "" });
  assert.equal(plain.post(encrypt("k", message("x"))).status, 400);
  assert.match(plain.ch.status().feishu, /^error: events are encrypted/);
});

test("the Encrypt Key alone is enough proof; the token inside is still checked when set", () => {
  const KEY = "k2";
  const onlyKey = rig({ verify: "", encryptKey: KEY });
  assert.equal(onlyKey.post(encrypt(KEY, message("ok", { token: "whatever" }))).status, 200);
  assert.equal(onlyKey.got.length, 1);
  const both = rig({ encryptKey: KEY });
  assert.equal(both.post(encrypt(KEY, message("no", { token: "wrong" }))).status, 403);
  assert.equal(both.got.length, 0);
});

test("a redelivered event is taken once; other event types, non-text and bot messages are ignored", () => {
  const r = rig();
  const m = message("once", { eventId: "ev-dup" });
  assert.equal(r.post(m).status, 200);
  assert.equal(r.post(m).status, 200, "still acknowledged");
  assert.equal(r.got.length, 1);
  // the platform's own advice: a second push of one message can carry a NEW event_id
  r.post(message("once", { messageId: m.event.message.message_id }));
  assert.equal(r.got.length, 1, "deduplicated on message_id");
  r.post(message("x", { type: "im.message.message_read_v1" }));
  r.post(message("x", { messageType: "image" }));
  r.post(message("x", { senderType: "app" }));
  r.post(message("   "));
  assert.equal(r.got.length, 1);
});

test("a mention placeholder from a group chat is not part of the order", () => {
  const r = rig();
  r.post(message("@_user_1 check project X"));
  r.post(message("@_all  @_user_12 standup"));
  assert.deepEqual(r.got.map((g) => g.text), ["check project X", "standup"]);
});

test("the allowlist pins the office to one sender or one chat", () => {
  const byUser = rig({ chat: "ou_owner" });
  byUser.post(message("mine")); byUser.post(message("a stranger", { openId: "ou_other" }));
  assert.deepEqual(byUser.got.map((g) => g.text), ["mine"]);
  const byChat = rig({ chat: "oc_team" });
  byChat.post(message("in the room", { chatId: "oc_team", openId: "ou_anyone" }));
  byChat.post(message("elsewhere", { chatId: "oc_other" }));
  assert.deepEqual(byChat.got.map((g) => g.text), ["in the room"]);
});

test("relay reaches the last chat that spoke — or the allowlisted id before anyone has", async () => {
  const r = rig();
  r.ch.relay("nobody to tell yet");
  await tick(); await tick();
  assert.equal(r.calls.length, 0, "no target, no call");
  r.post(message("hi", { chatId: "oc_live" }));
  r.ch.relay("📥 an approval is waiting");
  await tick(); await tick(); await tick();
  assert.equal(r.sends()[0].body.receive_id, "oc_live");

  const pinned = rig({ chat: "ou_owner" });
  pinned.ch.relay("after a restart");
  await tick(); await tick(); await tick();
  assert.equal(pinned.sends()[0].path, "/open-apis/im/v1/messages?receive_id_type=open_id");
  assert.equal(pinned.sends()[0].body.receive_id, "ou_owner");
});

test("saving the card checks the credentials: ready on a good secret, an error on a bad one", async () => {
  const good = rig();
  good.ch.restart(); await tick(450);
  assert.equal(good.ch.status().feishu, "ready — waiting for events");
  const bad = rig({}, { badSecret: true });
  bad.ch.restart(); await tick(450);
  assert.match(bad.ch.status().feishu, /^error: app secret invalid/);
  // …and a bad secret stays red even when events arrive (found against the real
  // endpoint: the Request URL check used to paint the light green over the error).
  assert.equal(bad.post({ challenge: "c", token: "vtok", type: "url_verification" }).status, 200);
  bad.post(message("hello"));
  assert.match(bad.ch.status().feishu, /^error: app secret invalid/);
  const off = rig({ enabled: false });
  off.ch.restart(); await tick(450);
  assert.equal(off.ch.status().feishu, "off");
});

test("feishuDecrypt refuses a body that is not a whole number of blocks", () => {
  assert.throws(() => initChannels.feishuDecrypt("k", Buffer.from("short").toString("base64")), /bad ciphertext/);
});

test("the daemon and the settings card are wired to it", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const overlay = fs.readFileSync(path.join(__dirname, "..", "overlay.html"), "utf8");
  assert.match(server, /req\.url\.split\("\?"\)\[0\] === "\/channels\/feishu\/webhook"\) \{[^}]*channels\.feishuWebhook\(req, res, raw\)/, "the webhook route");
  assert.match(server, /\["telegram", "discord", "line", "slack", "whatsapp", "messenger", "feishu"\]\.includes\(kind\)/, "the config route accepts the kind");
  for (const f of ["appId", "encryptKey", "domain"]) assert.match(server, new RegExp(f + ": "), "saved field " + f);
  assert.match(overlay, /\["feishu", "[^"]*Feishu \/ Lark", "/, "a card in ⚙ CHANNELS");
  assert.match(overlay, /\/channels\/feishu\/webhook/, "the card names the URL to paste");
  assert.match(overlay, /f === "token" \|\| f === "secret" \|\| f === "encryptKey" \? 'type="password"'/, "the Encrypt Key is masked like a secret");
  assert.match(overlay, /querySelectorAll\("input\[data-f\], select\[data-f\]"\)/, "the host picker is saved with the form");
});
