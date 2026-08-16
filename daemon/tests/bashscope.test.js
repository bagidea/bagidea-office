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
