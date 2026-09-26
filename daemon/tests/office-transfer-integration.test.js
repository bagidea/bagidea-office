// Exercise the actual ZIP/domain/HTTP pipeline between two disposable offices.
// No real office daemon, model, MCP command, or workflow is started.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");
const { once } = require("node:events");
const createTransfer = require("../office-transfer");
const createHttp = require("../office-transfer-http");
const zip = require("../office-zip");
const { DEFAULT_MAIN_AGENT, DEFAULT_CEO_AGENT, SKILL_LIBRARY, BUILTIN_TOOLS } = require("../constants");
const CATEGORIES = ["team", "skills", "mcp", "workflows", "settings"];

async function office(t, source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bagidea-transfer-e2e-"));
  const workspace = path.join(root, "workspace"), daemonDir = path.join(root, "daemon");
  fs.mkdirSync(workspace, { recursive: true }); fs.mkdirSync(daemonDir);
  const reg = { agents: { main: structuredClone(DEFAULT_MAIN_AGENT), ceo: structuredClone(DEFAULT_CEO_AGENT) },
    skills: structuredClone(SKILL_LIBRARY), tools: Object.keys(BUILTIN_TOOLS), roles: ["Director", "Writer"],
    mcpServers: {}, triggers: [], apiKeys: { OPENAI_API_KEY: source ? "SOURCE_PRIVATE_CREDENTIAL" : "DESTINATION_PRIVATE_CREDENTIAL" },
    lang: "en", sound: !source, heartbeatMin: 0, socialMin: 0, proposalMin: 0, autoApprove: false };
  for (const skill of Object.values(reg.skills)) skill.builtin = true;
  if (source) {
    reg.agents.writer = { name: "Archive Writer", role: "Writer", prompt: "Write useful examples.", skills: ["portable-skill"], tools: ["Read", "mcp:portable-tool"], provider: "claude", avatar: 1 };
    reg.skills["portable-skill"] = { name: "Portable skill", description: "An archive test skill", content: "Follow the imported style guide." };
    reg.mcpServers["portable-tool"] = { command: "node example-mcp.js", env: { API_KEY: "MCP_PRIVATE_CREDENTIAL" } };
    fs.mkdirSync(path.join(workspace, "workflows"));
    fs.writeFileSync(path.join(workspace, "workflows", "portable-flow.json"), JSON.stringify({
      id: "portable-flow", name: "Portable workflow", nodes: [{ id: "start", type: "trigger", text: "Start" }, { id: "finish", type: "output", text: "Done" }],
      edges: [{ from: "start", to: "finish" }],
    }));
    reg.triggers.push({ id: "portable-trigger", kind: "schedule", workflowId: "portable-flow", enabled: true, cfg: { everyMin: 60 }, lastRun: 123, runs: 9 });
    fs.writeFileSync(path.join(workspace, "OFFICE.md"), "# Portable office\nUse a calm tone.\n");
    fs.mkdirSync(path.join(workspace, "instructions"));
    fs.writeFileSync(path.join(workspace, "instructions", "style.md"), "# Style\nPrefer concrete examples.\n");
  }
  fs.writeFileSync(path.join(daemonDir, "registry.json"), JSON.stringify(reg));
  const transfer = createTransfer({ workspace, daemonDir, reg, maxStaff: 18 });
  let refreshed = 0;
  const handle = createHttp({ transfer, onImported: () => { refreshed++; } });
  const app = http.createServer((req, res) => { if (!handle(req, res)) { res.writeHead(404); res.end(); } });
  app.listen(0, "127.0.0.1"); await once(app, "listening");
  t.after(async () => {
    await new Promise((resolve) => { app.closeAllConnections(); app.close(resolve); });
    fs.rmSync(root, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + app.address().port;
  return { reg, workspace, daemonDir, refreshed: () => refreshed,
    request: (route, body) => fetch(base + "/office-transfer/" + route, { method: body === undefined ? "GET" : "POST",
      headers: { "x-bagidea-ui": "1", "content-type": Buffer.isBuffer(body) ? "application/zip" : "application/json" },
      body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) }),
  };
}

test("office transfer: an exported ZIP previews and restores team, skills, tools, workflows and Markdown through HTTP", async (t) => {
  const source = await office(t, true), destination = await office(t, false);
  const response = await source.request("export", { categories: CATEGORIES });
  assert.equal(response.status, 200, await response.clone().text());
  const archive = Buffer.from(await response.arrayBuffer());
  const entries = zip.decode(archive);
  assert.ok(entries.some((entry) => entry.name === "manifest.json"));
  const content = entries.map((entry) => entry.data.toString()).join("\n");
  assert.equal(content.includes("SOURCE_PRIVATE_CREDENTIAL"), false);
  assert.equal(content.includes("MCP_PRIVATE_CREDENTIAL"), false);
  const originalRegistry = JSON.stringify(destination.reg), registryRef = destination.reg;
  const previewResponse = await destination.request("preview", archive);
  const preview = await previewResponse.json();
  assert.equal(previewResponse.status, 200, JSON.stringify(preview));
  assert.ok(preview.entries.some((entry) => entry.category === "team" && entry.id === "writer"));
  assert.equal(JSON.stringify(destination.reg), originalRegistry, "preview must not mutate registry");
  assert.equal(fs.existsSync(path.join(destination.workspace, "OFFICE.md")), false);

  const resultResponse = await destination.request("import", { token: preview.token, conflict: "skip", categories: CATEGORIES });
  const result = await resultResponse.json();
  assert.equal(resultResponse.status, 200, JSON.stringify(result));
  assert.equal(result.ok, true);
  assert.equal(destination.reg, registryRef, "subsystems retain the same registry object");
  assert.equal(destination.reg.agents.writer.name, "Archive Writer");
  assert.equal(destination.reg.skills["portable-skill"].content, "Follow the imported style guide.");
  assert.equal(destination.reg.mcpServers["portable-tool"].command, "node example-mcp.js");
  assert.equal(destination.reg.apiKeys.OPENAI_API_KEY, "DESTINATION_PRIVATE_CREDENTIAL");
  assert.equal(destination.reg.autoApprove, false);
  assert.equal(destination.reg.triggers.find((trigger) => trigger.workflowId === "portable-flow").enabled, false);
  assert.match(fs.readFileSync(path.join(destination.workspace, "agents", "writer", ".claude", "skills", "portable-skill", "SKILL.md"), "utf8"), /Follow the imported style guide/);
  assert.match(fs.readFileSync(path.join(destination.workspace, "instructions", "style.md"), "utf8"), /Prefer concrete examples/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination.workspace, "workflows", "portable-flow.json"))).name, "Portable workflow");
  assert.equal(JSON.parse(fs.readFileSync(path.join(destination.daemonDir, "registry.json"))).agents.writer.name, "Archive Writer");
  assert.equal(destination.refreshed(), 1);
  assert.equal((await destination.request("import", { token: preview.token, conflict: "skip", categories: CATEGORIES })).status, 409);
});
