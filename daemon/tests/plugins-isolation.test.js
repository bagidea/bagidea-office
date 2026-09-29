const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const initPlugins = require("../plugins");

const server = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
const start = server.indexOf('const plugins = require("./plugins")({');
const end = server.indexOf("\n});", start);
assert.ok(start > 0 && end > start, "locate the real plugin initialization");
const initialize = server.slice(start, end + 4) + "\nplugins;";

function bootPluginHost(stateDir, isolated, factory) {
  return vm.runInNewContext(initialize, {
    require: (id) => { assert.equal(id, "./plugins"); return factory; },
    path, process: { env: isolated ? { OEP_STATE_DIR: stateDir } : {} },
    STATE_DIR: stateDir, WORKSPACE: path.join(stateDir, "workspace"),
    __dirname: path.join(stateDir, "unused-live-daemon"),
    broadcast() {}, reg: {}, saveReg() {}, console: { log() {} },
    tasks: {}, calendar: {}, triggers: {}, workflows: {}, skillTests: {},
  });
}

test("isolated daemon loads only fixture plugins and gives factories isolated state", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-plugin-isolation-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const pluginDir = path.join(root, "plugins", "probe");
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.writeFileSync(path.join(pluginDir, "plugin.json"), JSON.stringify({ id: "probe" }));
  fs.writeFileSync(path.join(pluginDir, "index.js"), `
    const fs = require("node:fs"), path = require("node:path");
    module.exports = (ctx) => {
      fs.writeFileSync(path.join(ctx.daemonDir, "probe-state.json"), JSON.stringify({ workspace: ctx.workspace }));
      fs.writeFileSync(path.join(ctx.dataDir, "probe-data.txt"), "isolated");
      return {};
    };
  `);
  const host = bootPluginHost(root, true, (ctx) => {
    // Fail before invoking any factory if the daemon points at live plugins.
    assert.equal(ctx.pluginsDir, path.join(root, "plugins"));
    assert.equal(ctx.daemonDir, root);
    return initPlugins(ctx);
  });
  assert.deepEqual(host.list().map((p) => p.id), ["probe"]);
  assert.equal(fs.readFileSync(path.join(pluginDir, "data", "probe-data.txt"), "utf8"), "isolated");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, "probe-state.json"), "utf8")),
    { workspace: path.join(root, "workspace") });
});

test("normal daemon keeps the plugin host's installed-tree default", () => {
  bootPluginHost("installed-daemon", false, (ctx) => {
    assert.equal(ctx.pluginsDir, undefined);
    assert.equal(ctx.daemonDir, "installed-daemon");
    return {};
  });
});
