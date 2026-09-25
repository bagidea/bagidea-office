// Owner UI boundary for portable office archives. Uploaded data stays in memory
// until an explicit import request consumes its short-lived preview token.
const crypto = require("node:crypto");
const { MAX_ARCHIVE_BYTES } = require("./office-zip");

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_PREVIEWS = 3;
const JSON_LIMIT = 16 * 1024;

module.exports = function createTransferHttp({ transfer, onImported = () => {}, now = Date.now }) {
  const previews = new Map();
  const routes = new Map([
    ["/office-transfer/summary", "GET"],
    ["/office-transfer/export", "POST"],
    ["/office-transfer/preview", "POST"],
    ["/office-transfer/import", "POST"],
  ]);
  function prune() {
    for (const [token, item] of previews) if (item.expires <= now()) previews.delete(token);
  }
  function json(res, status, body) {
    if (res.destroyed || res.writableEnded) return;
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
      // An early size rejection can leave unread body bytes. Do not reuse that
      // connection for the next request, which would be consumed as its body.
      ...(status === 413 ? { connection: "close" } : {}) });
    res.end(JSON.stringify(body));
  }
  function read(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0, settled = false;
      function fail(message, status = 400) {
        if (settled) return;
        settled = true;
        chunks.length = 0;
        reject(Object.assign(new Error(message), { status }));
      }
      const declared = Number(req.headers["content-length"] || 0);
      if (!Number.isFinite(declared) || declared < 0 || declared > limit) {
        req.resume();
        return fail("The upload is too large.", 413);
      }
      req.on("data", (chunk) => {
        if (settled) return;
        size += chunk.length;
        if (size > limit) return fail("The upload is too large.", 413);
        chunks.push(chunk);
      });
      req.on("end", () => { if (!settled) { settled = true; resolve(Buffer.concat(chunks)); } });
      req.on("aborted", () => fail("The upload was interrupted."));
      req.on("error", () => fail("The upload could not be read."));
    });
  }
  async function run(req, res, route) {
    try {
      prune();
      if (route === "/office-transfer/summary") {
        return json(res, 200, { ...transfer.summary(), limits: { maxArchiveBytes: MAX_ARCHIVE_BYTES } });
      }
      if (route === "/office-transfer/preview") {
        const data = await read(req, MAX_ARCHIVE_BYTES);
        const plan = transfer.previewArchive(data);
        // Retain only validated plans. Preview output never includes registry
        // content, Markdown bodies, credentials, or server-internal metadata.
        while (previews.size >= MAX_PREVIEWS) previews.delete(previews.keys().next().value);
        const token = crypto.randomBytes(24).toString("hex");
        previews.set(token, { plan, expires: now() + PREVIEW_TTL_MS });
        return json(res, 200, { token, categories: plan.categories, entries: plan.entries, warnings: plan.warnings });
      }
      let options;
      try { options = JSON.parse((await read(req, JSON_LIMIT)).toString("utf8")); }
      catch (e) { if (e.status) throw e; throw new Error("Expected a JSON request."); }
      if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("Expected an options object.");
      if (route === "/office-transfer/export") {
        const data = transfer.exportArchive(options.categories);
        res.writeHead(200, { "content-type": "application/zip", "content-length": data.length,
          "content-disposition": `attachment; filename="bagidea-office-${new Date(now()).toISOString().slice(0, 10)}.zip"`,
          "cache-control": "no-store", "x-content-type-options": "nosniff" });
        return res.end(data);
      }
      const item = typeof options.token === "string" && previews.get(options.token);
      if (!item || item.expires <= now()) {
        previews.delete(options.token);
        return json(res, 409, { error: "This preview expired or was already imported. Choose the ZIP again." });
      }
      if (options.conflict !== "skip" && options.conflict !== "replace") throw new Error("Choose skip or replace for existing items.");
      // Import revalidates against the current destination; a preview is not
      // permission to overwrite any destination that appeared since previewing.
      const result = transfer.importArchive(item.plan, { categories: options.categories, conflict: options.conflict });
      previews.delete(options.token);
      try { onImported(result); }
      catch { result.warnings = [...(result.warnings || []), "Imported successfully. Reload the office to refresh all views."]; }
      return json(res, 200, result);
    } catch (e) {
      json(res, e.status || 400, { error: String(e.message || "Office transfer failed.") });
    }
  }
  return function handle(req, res) {
    const route = req.url.split("?")[0];
    if (!route.startsWith("/office-transfer/")) return false;
    if (!routes.has(route)) { json(res, 404, { error: "Unknown office transfer endpoint." }); return true; }
    if (req.headers["x-bagidea-ui"] !== "1") { json(res, 403, { error: "Open Export / Import from Office Settings." }); return true; }
    // The daemon listens on loopback. Do not accept a third-party hostname
    // resolving to loopback as an office origin (DNS rebinding).
    if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(req.headers.host || "")) {
      json(res, 403, { error: "Open office transfer through the local office address." }); return true;
    }
    if (req.headers.origin) {
      let sameOrigin = false;
      try { sameOrigin = new URL(req.headers.origin).origin === "http://" + req.headers.host; } catch {}
      if (!sameOrigin) { json(res, 403, { error: "Office transfer must be opened from this office." }); return true; }
    }
    if (req.method !== routes.get(route)) { json(res, 405, { error: "Method not allowed." }); return true; }
    void run(req, res, route);
    return true;
  };
};

module.exports.PREVIEW_TTL_MS = PREVIEW_TTL_MS;
module.exports.MAX_PREVIEWS = MAX_PREVIEWS;
