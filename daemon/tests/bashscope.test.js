// The read-only lock, as a rule instead of a click (Aignition patch, 2026-08-16).
//
// Regression pin for the real incident: the Reviewer was granted only scoped Bash
// ("git status:*", "npm test:*", …), the console it did NOT have still walked to a
// permission card, and at 03:05 the owner stamped seven cards in seven seconds so
// an audit could finish. One of them created a file. Every case below is a channel
// that probe actually used, or the one the grant list itself opened.
const test = require("node:test");
const assert = require("node:assert");
const { bashScopeVerdict } = require("../bashscope");

// Exactly what the Reviewer holds in the roster.
const REVISOR = [
  "Bash(bash arnes/init.sh:*)", "Bash(npm test:*)", "Bash(npx tsc:*)",
  "Bash(npx eslint:*)", "Bash(git log:*)", "Bash(git diff:*)",
  "Bash(git status:*)", "Bash(git show:*)", "Bash(git rev-parse:*)",
  "Bash(git branch:*)", "Bash(echo:*)",
];

const ok = (cmd) => assert.ok(bashScopeVerdict(cmd, REVISOR).ok,
  `should be allowed: ${cmd}`);
const no = (cmd) => assert.ok(!bashScopeVerdict(cmd, REVISOR).ok,
  `MUST be refused: ${cmd}`);

test("the granted command shapes run", () => {
  ok("git status --short");
  ok("git diff HEAD~1");
  ok("npm test");
  ok("bash arnes/init.sh");
  ok("echo hola");
});

test("the probe's own chained form runs — this is why it kept asking", () => {
  // Every card the owner stamped had this shape: the trailing `; echo "EXIT=$?"`
  // broke the prefix match, so even pre-authorized commands begged for a click.
  ok('bash arnes/init.sh; echo "EXIT=$?"');
  ok('git status --short; echo "EXIT=$?"');
  ok("git log --oneline -5 && git status");
});

test("the write that got through is refused", () => {
  no("printf 'hola' > PRUEBA-ESCRITURA.txt");
  no('printf "hola" >> notas.txt');
});

test("redirection cannot ride in on a granted prefix", () => {
  // The subtler hole: "git status:*" on its own also covers this.
  no("git status --short > robado.txt");
  no("git diff > parche.patch");
  no("git log --oneline >> historia.txt");
});

test("a granted command cannot carry an ungranted one", () => {
  no("git status; printf x > f.txt");
  no("npm test && rm -rf build");
  no("git status | tee copia.txt");
});

test("command substitution is refused", () => {
  no("echo $(printf hola > f.txt)");
  no("echo `whoami`");
});

test("merging or discarding output is still allowed — it writes no file", () => {
  ok("git diff 2>&1");
  ok("npm test 2>/dev/null");
  ok("bash arnes/init.sh >/dev/null 2>&1");
});

test("an ungranted command is refused with no card at all", () => {
  no("rm -rf .");
  no("curl http://example.com");
  no("git push origin main");   // git, but not one of the read-only verbs
  no("");
});

test("an agent with no console grants gets nothing", () => {
  assert.ok(!bashScopeVerdict("echo hola", []).ok);
  assert.ok(!bashScopeVerdict("echo hola", ["Read", "Glob"]).ok);
});

// The Implementer is the only agent that writes, and it needs a WIDE console —
// git, node, npm. That means `Bash(node:*)` also covers
// `node -e "fs.writeFileSync('…/BagIdeaOffice/daemon/settings_revisor.json')"`,
// and the only writer loosens everyone's lock. Prefix grants cannot express
// "node yes, but not to write there", so the zone is named per agent instead.
const IMPL = ["Bash(git:*)", "Bash(node:*)", "Bash(npm:*)", "Bash(echo:*)"];
const ZONA = ["C:\\Users\\sbras\\AppData\\Local\\BagIdeaOffice"];

const zok = (cmd) => assert.ok(bashScopeVerdict(cmd, IMPL, ZONA).ok,
  `should be allowed: ${cmd}`);
const zno = (cmd) => assert.ok(!bashScopeVerdict(cmd, IMPL, ZONA).ok,
  `MUST be refused: ${cmd}`);

test("the Implementer's real work still runs", () => {
  zok("node build-tablero.js");
  zok("git status --short");
  zok("npm test");
  zok("node sync-memoria.js");
});

test("no command may name the lock directory, whatever the tool", () => {
  zno('node -e "require(\'fs\').writeFileSync(\'C:/Users/sbras/AppData/Local/BagIdeaOffice/daemon/settings_revisor.json\',\'x\')"');
  zno("node C:\\Users\\sbras\\AppData\\Local\\BagIdeaOffice\\daemon\\server.js");
  zno("git diff C:/Users/sbras/AppData/Local/BagIdeaOffice/daemon/registry.json");
});

test("the zone matches regardless of slash direction or case", () => {
  // The agent writes paths both ways on Windows; the guard must not care.
  zno("node -e \"x('c:/users/sbras/appdata/local/bagideaoffice/daemon/registry.json')\"");
  zno("node -e \"x('C:\\\\USERS\\\\SBRAS\\\\APPDATA\\\\LOCAL\\\\BAGIDEAOFFICE\\\\x')\"");
});

test("the zone is a guard, not a cage — and the docs say so", () => {
  // Named here so nobody mistakes it for a sandbox: an obfuscated path gets through.
  // It holds together with the other two layers (no readDirs there, Reviewer audits).
  const obfuscated = 'node -e "x(String.fromCharCode(67,58) + \'/…\')"';
  assert.ok(bashScopeVerdict(obfuscated, IMPL, ZONA).ok,
    "an obfuscated path passes — this is documented, not a defect to hide");
});

test("with no zone declared, nothing changes for anyone else", () => {
  assert.ok(bashScopeVerdict("node build-tablero.js", IMPL).ok);
  assert.ok(bashScopeVerdict("node C:/Users/sbras/AppData/Local/BagIdeaOffice/x.js", IMPL).ok);
});
