// Text-only run helpers (POST /chat textOnly:true → claude --tools "" --strict-mcp-config).
const test = require("node:test");
const assert = require("node:assert");
const { isTextOnly, applyTextOnly, shellJoins } = require("../textonly");

const SAMPLE = () => ["-p", "--output-format", "stream-json", "--verbose",
  "--allowedTools", "Read,Glob,Grep,mcp__web",
  "--settings", "C:\\office\\workspace\\.claude\\settings.json",
  "--mcp-config", "C:\\office\\state\\mcp_nova.json",
  "--add-dir", "C:\\office\\agents\\nova\\skills",
  "--resume", "sid-123",
  "--model", "lmstudio/gemma"];

test("isTextOnly: only the boolean true enables it", () => {
  assert.strictEqual(isTextOnly({ textOnly: true }), true);
  for (const v of [undefined, "true", 1, null, false, "1", {}, [true]])
    assert.strictEqual(isTextOnly({ textOnly: v }), false, JSON.stringify(v));
  assert.strictEqual(isTextOnly({}), false);
  assert.strictEqual(isTextOnly(null), false);
  assert.strictEqual(isTextOnly(undefined), false);
});

test("applyTextOnly (argv backend): --tools '' + --strict-mcp-config, drops tools/MCP/skills, keeps the rest in order", () => {
  const input = SAMPLE();
  const before = JSON.stringify(input);
  const out = applyTextOnly(input, { backendKind: "docker" });
  assert.deepStrictEqual(out, ["-p", "--output-format", "stream-json", "--verbose",
    "--tools", "", "--strict-mcp-config",
    "--settings", "C:\\office\\workspace\\.claude\\settings.json",
    "--resume", "sid-123",
    "--model", "lmstudio/gemma"]);
  for (const f of ["--allowedTools", "--mcp-config", "--add-dir"]) assert.ok(!out.includes(f), f);
  assert.strictEqual(JSON.stringify(input), before, "input array must not be mutated");
  assert.notStrictEqual(out, input);
});

test("applyTextOnly (local = shell:true): empty value is a literal \"\" so the shell keeps it", () => {
  const out = applyTextOnly(SAMPLE(), { backendKind: "local" });
  const i = out.indexOf("--tools");
  assert.strictEqual(out[i + 1], '""');
  assert.strictEqual(out[i + 2], "--strict-mcp-config");
  // default backendKind is local
  assert.deepStrictEqual(applyTextOnly(SAMPLE()), out);
  // the shell-joined command line (what node builds for shell:true) keeps a real token
  assert.match(out.join(" "), /--tools "" --strict-mcp-config --settings /);
});

test("shellJoins: only the local backend joins argv through a shell", () => {
  assert.strictEqual(shellJoins("local"), true);
  assert.strictEqual(shellJoins(undefined), true);
  assert.strictEqual(shellJoins("docker"), false);
  assert.strictEqual(shellJoins("ssh"), false);
});

test("applyTextOnly without --allowedTools/--mcp-config/--add-dir still adds the flags once", () => {
  const out = applyTextOnly(["-p", "--settings", "S", "--resume", "R"], { backendKind: "docker" });
  assert.deepStrictEqual(out, ["-p", "--settings", "S", "--resume", "R", "--tools", "", "--strict-mcp-config"]);
  // idempotent: applying twice gives the same result
  assert.deepStrictEqual(applyTextOnly(out, { backendKind: "docker" }), out);
});

test("default path: args untouched when not text-only (runClaude only rewrites when opts.textOnly === true)", () => {
  const input = SAMPLE();
  const copy = input.slice();
  // mirror of the server.js gate: `if (opts.textOnly === true) ...`
  for (const opts of [{}, { textOnly: "true" }, { textOnly: 1 }, { textOnly: null }]) {
    const args = input.slice();
    if (opts.textOnly === true) args.splice(0, args.length, ...applyTextOnly(args));
    assert.deepStrictEqual(args, copy);
  }
  assert.deepStrictEqual(input, copy);
});
