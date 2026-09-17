// Tests for daemon/media.js.
//
// These do NOT call a real provider. Generating a picture costs the owner
// money and a video costs dollars per clip, so what is asserted here is
// everything that can be wrong without spending any: the request the office
// builds, the way it falls from one provider to the next, whether a failure
// says something useful, and the video poll's state machine.
//
// The provider calls go through https, so the tests swap https.request for a
// recorder. That is the seam the module actually uses.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const https = require("node:https");
const { EventEmitter } = require("node:events");

const M = require("../media");

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-media-"));

// A fake https.request: records what was asked for, replies with a queued answer.
let sent = [];
let replies = [];
const realRequest = https.request;

function fakeHttps() {
  https.request = (opts, cb) => {
    const rec = { opts, body: "" };
    sent.push(rec);
    const req = new EventEmitter();
    req.write = (b) => { rec.body += b; };
    req.setTimeout = () => {};
    req.destroy = () => {};
    req.end = () => {
      const next = replies.shift() || { status: 200, body: "{}" };
      setImmediate(() => {
        const res = new EventEmitter();
        res.statusCode = next.status;
        cb(res);
        res.emit("data", Buffer.isBuffer(next.body) ? next.body : Buffer.from(String(next.body)));
        res.emit("end");
      });
    };
    return req;
  };
}
test.before(fakeHttps);
test.after(() => { https.request = realRequest; });
const reset = () => { sent = []; replies = []; };

const pngB64 = Buffer.from("fake-png-bytes").toString("base64");

// ── image ──────────────────────────────────────────────────────────────
test("image: OpenAI is asked first when its key is present", async () => {
  reset();
  replies = [{ status: 200, body: JSON.stringify({ data: [{ b64_json: pngB64 }] }) }];
  const out = await M.image("a cat", { keys: { OPENAI_API_KEY: "k" }, uploads: tmpDir() });
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].opts.host, "api.openai.com");
  assert.match(out.url, /^\/uploads\/gen_.*\.png$/);
  assert.strictEqual(fs.readFileSync(out.path, "utf8"), "fake-png-bytes");
});

test("image: falls through to Gemini when OpenAI errors", async () => {
  reset();
  replies = [
    { status: 400, body: JSON.stringify({ error: { message: "billing hard limit reached" } }) },
    { status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: pngB64 } }] } }] }) },
  ];
  const out = await M.image("a cat", { keys: { OPENAI_API_KEY: "k", GEMINI_API_KEY: "g" }, uploads: tmpDir() });
  assert.strictEqual(sent.length, 2);
  assert.match(sent[1].opts.host, /googleapis/);
  assert.ok(out.path);
});

test("image: when everything fails, the message says what each provider said", async () => {
  // "failed" is not something anyone can act on. The reason each provider gave
  // is.
  reset();
  replies = [
    { status: 400, body: JSON.stringify({ error: { message: "billing hard limit reached" } }) },
    { status: 429, body: JSON.stringify({ error: { message: "quota exceeded" } }) },
  ];
  await assert.rejects(
    () => M.image("a cat", { keys: { OPENAI_API_KEY: "k", GEMINI_API_KEY: "g" }, uploads: tmpDir() }),
    (e) => /billing hard limit/.test(e.message) && /quota exceeded/.test(e.message));
});

test("image: with no keys at all it names the keys it needs", async () => {
  reset();
  await assert.rejects(() => M.image("a cat", { keys: {}, uploads: tmpDir() }),
    /no OPENAI_API_KEY.*no GEMINI_API_KEY/s);
});

test("image: an empty prompt is refused before any request is made", async () => {
  reset();
  await assert.rejects(() => M.image("", { keys: { OPENAI_API_KEY: "k" }, uploads: tmpDir() }), /no prompt/);
  assert.strictEqual(sent.length, 0, "a request was made for an empty prompt");
});

// ── edit ───────────────────────────────────────────────────────────────
test("edit: sends the picture inline, with the instruction after it", async () => {
  reset();
  const dir = tmpDir();
  const src = path.join(dir, "in.png");
  fs.writeFileSync(src, "original-bytes");
  replies = [{ status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: pngB64 } }] } }] }) }];
  const out = await M.edit(src, "make the sky darker", { keys: { GEMINI_API_KEY: "g" }, uploads: dir });
  const body = JSON.parse(sent[0].body);
  const parts = body.contents[0].parts;
  assert.ok(parts[0].inlineData, "the image is not the first part");
  assert.strictEqual(Buffer.from(parts[0].inlineData.data, "base64").toString(), "original-bytes");
  assert.strictEqual(parts[1].text, "make the sky darker");
  assert.notStrictEqual(out.path, src, "the edit overwrote the original");
  assert.strictEqual(fs.readFileSync(src, "utf8"), "original-bytes", "the original was modified");
});

test("edit: the mime type follows the file, not a guess", async () => {
  reset();
  const dir = tmpDir();
  const src = path.join(dir, "in.jpg");
  fs.writeFileSync(src, "jpeg-bytes");
  replies = [{ status: 200, body: JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: pngB64 } }] } }] }) }];
  await M.edit(src, "brighter", { keys: { GEMINI_API_KEY: "g" }, uploads: dir });
  assert.strictEqual(JSON.parse(sent[0].body).contents[0].parts[0].inlineData.mimeType, "image/jpeg");
});

test("edit: a missing file says which file", async () => {
  reset();
  await assert.rejects(() => M.edit("C:/nope/missing.png", "x",
    { keys: { GEMINI_API_KEY: "g" }, uploads: tmpDir() }), /cannot read .*missing\.png/);
});

// ── video ──────────────────────────────────────────────────────────────
test("video: the request carries the prompt and aspect ratio", async () => {
  reset();
  replies = [{ status: 200, body: JSON.stringify({ name: "models/veo/operations/abc" }) }];
  const started = await M.videoStart("a lobster walking", { keys: { GEMINI_API_KEY: "g" } }, { aspectRatio: "9:16" });
  assert.strictEqual(started.op, "models/veo/operations/abc");
  assert.match(sent[0].opts.path, /:predictLongRunning/);
  const body = JSON.parse(sent[0].body);
  assert.strictEqual(body.instances[0].prompt, "a lobster walking");
  assert.strictEqual(body.parameters.aspectRatio, "9:16");
});

test("video: an image becomes the first frame", async () => {
  reset();
  const dir = tmpDir();
  const src = path.join(dir, "first.png");
  fs.writeFileSync(src, "frame-bytes");
  replies = [{ status: 200, body: JSON.stringify({ name: "ops/1" }) }];
  await M.videoStart("pan left", { keys: { GEMINI_API_KEY: "g" } }, { image: src });
  const inst = JSON.parse(sent[0].body).instances[0];
  assert.strictEqual(Buffer.from(inst.image.bytesBase64Encoded, "base64").toString(), "frame-bytes");
  assert.strictEqual(inst.image.mimeType, "image/png");
});

test("video: a rejected request surfaces the API's own words", async () => {
  reset();
  replies = [{ status: 403, body: JSON.stringify({ error: { message: "Veo is not enabled for this project" } }) }];
  await assert.rejects(() => M.videoStart("x", { keys: { GEMINI_API_KEY: "g" } }),
    /Veo is not enabled/);
});

test("video: without a key it says which key, before spending anything", async () => {
  reset();
  await assert.rejects(() => M.videoStart("x", { keys: {} }), /GEMINI_API_KEY/);
  assert.strictEqual(sent.length, 0);
});

test("video: an unfinished operation reports not-done rather than failing", async () => {
  reset();
  replies = [{ status: 200, body: JSON.stringify({ done: false }) }];
  assert.deepStrictEqual(await M.videoPoll("ops/1", { keys: { GEMINI_API_KEY: "g" } }), { done: false });
});

test("video: a finished operation downloads the file", async () => {
  reset();
  const dir = tmpDir();
  replies = [
    { status: 200, body: JSON.stringify({ done: true, response: { generateVideoResponse: {
      generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/x:download" } }] } } }) },
    { status: 200, body: Buffer.from("mp4-bytes") },
  ];
  const out = await M.videoPoll("ops/1", { keys: { GEMINI_API_KEY: "g" }, uploads: dir });
  assert.strictEqual(out.done, true);
  assert.match(out.url, /\.mp4$/);
  assert.strictEqual(fs.readFileSync(out.path, "utf8"), "mp4-bytes");
  assert.match(sent[1].opts.path, /key=g/, "the download did not carry the key");
});

test("video: 'done' with no video in it is an error, not a silent success", async () => {
  reset();
  replies = [{ status: 200, body: JSON.stringify({ done: true, response: { raiFilteredReason: "blocked" } }) }];
  await assert.rejects(() => M.videoPoll("ops/1", { keys: { GEMINI_API_KEY: "g" }, uploads: tmpDir() }),
    /finished without a video.*blocked/s);
});

test("video: an operation that errored reports the reason", async () => {
  reset();
  replies = [{ status: 200, body: JSON.stringify({ error: { message: "internal" } }) }];
  await assert.rejects(() => M.videoPoll("ops/1", { keys: { GEMINI_API_KEY: "g" } }), /internal/);
});

test("video: the waiting form gives up with a message that says it may still finish", async () => {
  reset();
  replies = [
    { status: 200, body: JSON.stringify({ name: "ops/1" }) },
    { status: 200, body: JSON.stringify({ done: false }) },
    { status: 200, body: JSON.stringify({ done: false }) },
  ];
  await assert.rejects(
    () => M.video("x", { keys: { GEMINI_API_KEY: "g" }, uploads: tmpDir() }, { pollMs: 5, maxMs: 10 }),
    /still generating.*may still finish/s);
});

test("saveFile: two files made in the same millisecond do not collide", () => {
  const dir = tmpDir();
  const a = M.saveFile(dir, ".png", Buffer.from("a"));
  const b = M.saveFile(dir, ".png", Buffer.from("b"));
  assert.notStrictEqual(a.path, b.path);
  assert.strictEqual(fs.readFileSync(a.path, "utf8"), "a");
  assert.strictEqual(fs.readFileSync(b.path, "utf8"), "b");
});
