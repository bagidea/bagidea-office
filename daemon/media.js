// BagIdea Office — the media room.
//
// The office could already turn text into a picture. What it could not do was
// change one, or make anything that moves — so any real production job (a game
// asset, a trailer, a mock-up to iterate on) left the office halfway through.
//
// Three operations, one shape:
//   image(prompt)                text  → PNG
//   edit(file, prompt)           image → PNG          ("make the sky darker")
//   video(prompt, opts)          text or image → MP4  (long-running)
//
// Every one returns a plain { path, url } for a file written into the office's
// uploads folder, so anything already able to show an upload can show these.
//
// Providers are tried in order and the FIRST that has a key wins, with the
// reason each one declined carried through — "no OPENAI_API_KEY, and gemini
// said: quota exceeded" is a message someone can act on, where "failed" is not.

const fs = require("fs");
const path = require("path");
const https = require("https");

const GEMINI_HOST = "generativelanguage.googleapis.com";
const IMAGE_TIMEOUT = 180000;
// Video generation is minutes, not seconds. This is the cap on the whole poll,
// not on one request.
const VIDEO_POLL_MS = 10000;
const VIDEO_MAX_MS = 10 * 60000;

function req(opts, body, timeout) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, (rs) => {
      const chunks = [];
      rs.on("data", (c) => chunks.push(c));
      rs.on("end", () => resolve({ status: rs.statusCode, buf: Buffer.concat(chunks) }));
    });
    r.setTimeout(timeout || IMAGE_TIMEOUT, () => r.destroy(new Error("timed out after " + ((timeout || IMAGE_TIMEOUT) / 1000) + "s")));
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

const asJson = (buf) => { try { return JSON.parse(buf.toString("utf8")); } catch { return null; } };
// An API that answers with an error object is more useful than a status code.
const apiError = (j, fallback) => (j && j.error && j.error.message) || fallback;

function saveFile(dir, ext, data) {
  fs.mkdirSync(dir, { recursive: true });
  const name = "gen_" + Date.now() + "_" + Math.floor(process.hrtime()[1] % 1e6) + ext;
  const full = path.join(dir, name);
  fs.writeFileSync(full, data);
  return { path: full, url: "/uploads/" + name };
}

const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif" };

// ── image: text → PNG ──────────────────────────────────────────────────
async function image(prompt, ctx) {
  const { keys = {}, uploads, onCost } = ctx;
  const why = [];
  const text = String(prompt || "").slice(0, 4000);
  if (!text) throw new Error("no prompt");

  if (keys.OPENAI_API_KEY) {
    const body = JSON.stringify({ model: "gpt-image-1", prompt: text, size: "1024x1024" });
    try {
      const { buf } = await req({ method: "POST", host: "api.openai.com",
        path: "/v1/images/generations",
        headers: { authorization: "Bearer " + keys.OPENAI_API_KEY,
          "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, body);
      const j = asJson(buf);
      const b64 = j && j.data && j.data[0] && j.data[0].b64_json;
      if (b64) { if (onCost) onCost("openai", "image"); return saveFile(uploads, ".png", Buffer.from(b64, "base64")); }
      why.push("openai: " + apiError(j, "empty response"));
    } catch (e) { why.push("openai: " + e.message); }
  } else why.push("no OPENAI_API_KEY");

  if (keys.GEMINI_API_KEY) {
    const body = JSON.stringify({
      contents: [{ parts: [{ text: "Generate an image: " + text }] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    });
    try {
      const { buf } = await req({ method: "POST", host: GEMINI_HOST,
        path: "/v1beta/models/gemini-2.5-flash-image:generateContent?key=" + keys.GEMINI_API_KEY,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, body);
      const j = asJson(buf);
      const part = j && j.candidates && j.candidates[0] &&
        (j.candidates[0].content.parts || []).find((x) => x.inlineData);
      if (part) { if (onCost) onCost("gemini", "image"); return saveFile(uploads, ".png", Buffer.from(part.inlineData.data, "base64")); }
      why.push("gemini: " + apiError(j, "empty response"));
    } catch (e) { why.push("gemini: " + e.message); }
  } else why.push("no GEMINI_API_KEY");

  throw new Error("could not generate an image — " + why.join("; "));
}

// ── edit: image + instruction → PNG ────────────────────────────────────
// Gemini goes first here, not second. Its image model takes an instruction
// about a picture directly ("make the sky darker"); OpenAI's edit endpoint is
// built around a mask, and without one it rewrites more than it was asked to.
async function edit(file, prompt, ctx) {
  const { keys = {}, uploads, onCost } = ctx;
  const text = String(prompt || "").slice(0, 4000);
  if (!text) throw new Error("no instruction");
  let data;
  try { data = fs.readFileSync(file); } catch { throw new Error("cannot read " + file); }
  const mime = MIME[path.extname(file).toLowerCase()] || "image/png";
  const why = [];

  if (keys.GEMINI_API_KEY) {
    const body = JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType: mime, data: data.toString("base64") } },
        { text },
      ] }],
      generationConfig: { responseModalities: ["TEXT", "IMAGE"] },
    });
    try {
      const { buf } = await req({ method: "POST", host: GEMINI_HOST,
        path: "/v1beta/models/gemini-2.5-flash-image:generateContent?key=" + keys.GEMINI_API_KEY,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, body);
      const j = asJson(buf);
      const part = j && j.candidates && j.candidates[0] &&
        (j.candidates[0].content.parts || []).find((x) => x.inlineData);
      if (part) { if (onCost) onCost("gemini", "image"); return saveFile(uploads, ".png", Buffer.from(part.inlineData.data, "base64")); }
      why.push("gemini: " + apiError(j, "empty response"));
    } catch (e) { why.push("gemini: " + e.message); }
  } else why.push("no GEMINI_API_KEY");

  throw new Error("could not edit the image — " + why.join("; "));
}

// ── video: text (or an image) → MP4 ────────────────────────────────────
// Long-running: the API hands back an operation name and the result arrives
// minutes later. Kept as start/poll rather than one awaited call so a caller
// can show progress and survive a restart mid-generation.
function videoStart(prompt, ctx, opts = {}) {
  const { keys = {} } = ctx;
  if (!keys.GEMINI_API_KEY) return Promise.reject(new Error("video needs GEMINI_API_KEY (⚙ CONNECT)"));
  const model = String(opts.model || "veo-3.0-generate-001");
  const instance = { prompt: String(prompt || "").slice(0, 2000) };
  if (opts.image) {
    // image → video: the still is the first frame.
    const data = fs.readFileSync(opts.image);
    instance.image = {
      bytesBase64Encoded: data.toString("base64"),
      mimeType: MIME[path.extname(opts.image).toLowerCase()] || "image/png",
    };
  }
  const body = JSON.stringify({
    instances: [instance],
    parameters: { aspectRatio: opts.aspectRatio || "16:9" },
  });
  return req({ method: "POST", host: GEMINI_HOST,
    path: "/v1beta/models/" + model + ":predictLongRunning?key=" + keys.GEMINI_API_KEY,
    headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } }, body)
    .then(({ buf }) => {
      const j = asJson(buf);
      if (j && j.name) return { op: j.name, model };
      throw new Error(apiError(j, "the video request was not accepted"));
    });
}

// One poll. Returns { done:false } or { done:true, ...file } or throws.
async function videoPoll(op, ctx) {
  const { keys = {}, uploads, onCost } = ctx;
  const { buf } = await req({ method: "GET", host: GEMINI_HOST,
    path: "/v1beta/" + String(op).replace(/^\/+/, "") + "?key=" + keys.GEMINI_API_KEY }, null, 60000);
  const j = asJson(buf);
  if (!j) throw new Error("could not read the operation status");
  if (j.error) throw new Error(apiError(j, "video generation failed"));
  if (!j.done) return { done: false };
  const resp = j.response || {};
  const sample = (resp.generateVideoResponse && resp.generateVideoResponse.generatedSamples &&
    resp.generateVideoResponse.generatedSamples[0]) ||
    (resp.generatedSamples && resp.generatedSamples[0]);
  const uri = sample && sample.video && (sample.video.uri || sample.video.url);
  if (!uri) throw new Error("the operation finished without a video — " +
    JSON.stringify(resp).slice(0, 300));
  // The file lives behind the same key.
  const u = new URL(uri.includes("key=") ? uri : uri + (uri.includes("?") ? "&" : "?") + "key=" + keys.GEMINI_API_KEY);
  const got = await req({ method: "GET", host: u.host, path: u.pathname + u.search }, null, 300000);
  if (got.status !== 200) throw new Error("could not download the video (" + got.status + ")");
  if (onCost) onCost("gemini", "video");
  return { done: true, ...saveFile(uploads, ".mp4", got.buf) };
}

// Convenience for callers that would rather just wait.
async function video(prompt, ctx, opts = {}) {
  const started = await videoStart(prompt, ctx, opts);
  const until = Date.now() + (opts.maxMs || VIDEO_MAX_MS);
  for (;;) {
    await new Promise((r) => setTimeout(r, opts.pollMs || VIDEO_POLL_MS));
    const st = await videoPoll(started.op, ctx);
    if (st.done) return st;
    if (Date.now() > until)
      throw new Error("the video was still generating after " +
        Math.round((opts.maxMs || VIDEO_MAX_MS) / 60000) + " minutes — it may still finish; check the operation");
  }
}

module.exports = { image, edit, video, videoStart, videoPoll, saveFile, MIME };
