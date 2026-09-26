const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { once } = require("node:events");
const createHttp = require("../office-transfer-http");
const { JSON_LIMIT, EXPORT_JSON_LIMIT } = createHttp;
const { MAX_ARCHIVE_BYTES } = require("../office-zip");

async function server(t, overrides = {}) {
  let time = 1000, committed = 0, refreshed = 0;
  const counts = { team: 1, skills: 2, mcp: 0, workflows: 0, settings: 1 };
  const transfer = {
    summary: () => ({ categories: counts }),
    exportArchive: (categories) => {
      assert.deepEqual(categories, ["team"]);
      return Buffer.from([0x50, 0x4b, 0, 255]);
    },
    previewArchive: (data) => {
      if (data.toString() === "invalid") throw new Error("Invalid office archive.");
      return { categories: counts, entries: [{ category: "team", id: "writer", label: "Writer", conflict: true }],
        warnings: ["Credentials excluded."], internal: { privateBody: "not-for-preview-response" } };
    },
    importArchive: (plan, options) => {
      assert.equal(plan.internal.privateBody, "not-for-preview-response");
      if (options.categories[0] === "invalid") throw new Error("Select valid categories.");
      committed++;
      return { ok: true, imported: counts, skipped: {}, warnings: [] };
    }, ...overrides.transfer,
  };
  const handler = createHttp({ transfer, now: () => time, onImported: () => { refreshed++; overrides.onImported?.(); } });
  const app = http.createServer((req, res) => { if (!handler(req, res)) { res.writeHead(404); res.end("unhandled"); } });
  app.listen(0, "127.0.0.1");
  await once(app, "listening");
  t.after(() => new Promise((resolve) => { app.closeAllConnections(); app.close(resolve); }));
  const base = "http://127.0.0.1:" + app.address().port;
  return { base, app, state: () => ({ committed, refreshed }), advance: (ms) => { time += ms; },
    request: (route, options = {}) => fetch(base + route, { ...options,
      headers: { "x-bagidea-ui": "1", ...options.headers } }),
  };
}
const upload = (s, text = "zip") => s.request("/office-transfer/preview", { method: "POST", body: text });
const apply = (s, token, more = {}) => s.request("/office-transfer/import", { method: "POST",
  body: JSON.stringify({ token, categories: ["team"], conflict: "skip", ...more }) });

test("transfer HTTP: owner UI, same origin, methods and routing are enforced", async (t) => {
  const s = await server(t);
  assert.equal((await fetch(s.base + "/office-transfer/summary")).status, 403);
  assert.equal((await s.request("/office-transfer/summary", { headers: { origin: "https://example.com" } })).status, 403);
  assert.equal((await s.request("/office-transfer/summary", { headers: { host: "attacker.example", origin: "http://attacker.example" } })).status, 403);
  assert.equal((await s.request("/office-transfer/summary", { headers: { origin: s.base } })).status, 200);
  assert.equal((await s.request("/office-transfer/export")).status, 405);
  assert.equal((await s.request("/office-transfer/nope")).status, 404);
  assert.equal(await (await s.request("/different-route")).text(), "unhandled");
  const response = await s.request("/office-transfer/summary");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal((await response.json()).limits.maxArchiveBytes, MAX_ARCHIVE_BYTES);
});

test("transfer HTTP: export is a binary ZIP attachment", async (t) => {
  const s = await server(t);
  const r = await s.request("/office-transfer/export", { method: "POST", body: JSON.stringify({ categories: ["team"] }) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "application/zip");
  assert.match(r.headers.get("content-disposition"), /attachment; filename="bagidea-office-\d{4}-\d{2}-\d{2}\.zip"/);
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), Buffer.from([0x50, 0x4b, 0, 255]));
});

test("transfer HTTP: preview is read-only and internal archive data never reaches the response", async (t) => {
  const s = await server(t);
  const r = await upload(s);
  const body = await r.text(), p = JSON.parse(body);
  assert.match(p.token, /^[a-f0-9]{48}$/);
  assert.equal(p.entries[0].id, "writer");
  assert.equal(body.includes("not-for-preview-response"), false);
  assert.equal(body.includes("internal"), false);
  assert.deepEqual(s.state(), { committed: 0, refreshed: 0 });
  assert.equal((await apply(s, p.token)).status, 200);
  assert.deepEqual(s.state(), { committed: 1, refreshed: 1 });
  assert.equal((await apply(s, p.token)).status, 409);
});

test("transfer HTTP: expired and evicted previews cannot import", async (t) => {
  const s = await server(t);
  const first = await (await upload(s)).json();
  s.advance(createHttp.PREVIEW_TTL_MS);
  assert.equal((await apply(s, first.token)).status, 409);
  const tokens = [];
  for (let i = 0; i < createHttp.MAX_PREVIEWS + 1; i++) tokens.push((await (await upload(s)).json()).token);
  assert.equal((await apply(s, tokens[0])).status, 409);
  assert.equal((await apply(s, tokens.at(-1))).status, 200);
});

test("transfer HTTP: invalid imports remain retryable without mutation", async (t) => {
  const s = await server(t);
  const p = await (await upload(s)).json();
  assert.equal((await apply(s, p.token, { conflict: "delete" })).status, 400);
  assert.equal((await apply(s, p.token, { categories: ["invalid"] })).status, 400);
  assert.deepEqual(s.state(), { committed: 0, refreshed: 0 });
  assert.equal((await apply(s, p.token)).status, 200);
  assert.equal((await upload(s, "invalid")).status, 400);
  assert.equal((await s.request("/office-transfer/export", { method: "POST", body: "{" })).status, 400);
});

test("transfer HTTP: preview expiring while the import body uploads cannot commit", async (t) => {
  const s = await server(t);
  const preview = await (await upload(s)).json();
  s.advance(createHttp.PREVIEW_TTL_MS - 1);
  const body = JSON.stringify({ token: preview.token, conflict: "skip", categories: ["team"] });
  const received = once(s.app, "request");
  let request;
  const response = new Promise((resolve, reject) => {
    request = http.request(s.base + "/office-transfer/import", { method: "POST", headers: {
      "x-bagidea-ui": "1", "content-length": Buffer.byteLength(body),
    } }, (res) => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    request.on("error", reject); request.flushHeaders();
  });
  await received;
  s.advance(2);
  request.end(body);
  assert.equal(await response, 409);
  assert.deepEqual(s.state(), { committed: 0, refreshed: 0 });
});

test("transfer HTTP: body limits reject chunked and declared oversized requests", async (t) => {
  const s = await server(t);
  assert.equal((await s.request("/office-transfer/import", { method: "POST", body: "x".repeat(JSON_LIMIT + 1024) })).status, 413);
  assert.equal((await s.request("/office-transfer/export", { method: "POST", body: "x".repeat(EXPORT_JSON_LIMIT + 1) })).status, 413);
  const r = await new Promise((resolve, reject) => {
    const req = http.request(s.base + "/office-transfer/preview", { method: "POST",
      headers: { "x-bagidea-ui": "1", "content-length": MAX_ARCHIVE_BYTES + 1 } }, (res) => {
      res.resume(); res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject); req.end();
  });
  assert.equal(r, 413);
  const chunked = await new Promise((resolve, reject) => {
    const req = http.request(s.base + "/office-transfer/import", { method: "POST", headers: { "x-bagidea-ui": "1" } }, (res) => {
      res.resume(); res.on("end", () => resolve(res.statusCode));
    });
    req.on("error", reject); req.write("a".repeat(9000)); req.end("b".repeat(9000));
  });
  assert.equal(chunked, 413);
});

test("transfer HTTP: refresh errors report a completed import instead of encouraging a duplicate", async (t) => {
  const s = await server(t, { onImported: () => { throw new Error("view disconnected"); } });
  const p = await (await upload(s)).json();
  const r = await apply(s, p.token), result = await r.json();
  assert.equal(r.status, 200); assert.equal(result.ok, true);
  assert.match(result.warnings[0], /Imported successfully/);
  assert.equal((await apply(s, p.token)).status, 409);
});

test("transfer HTTP: export forwards the per-item selection", async (t) => {
  let seen;
  const s = await server(t, { transfer: { exportArchive: (categories, items) => { seen = { categories, items }; return Buffer.from([0x50, 0x4b]); } } });
  const items = { team: Array.from({ length: 3000 }, (_, i) => "agent-" + i) };
  const r = await s.request("/office-transfer/export", { method: "POST", body: JSON.stringify({ categories: ["team"], items }) });
  assert.equal(r.status, 200);
  assert.deepEqual(seen, { categories: ["team"], items });
});
