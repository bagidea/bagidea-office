// Text-only runs (opt-in, POST /chat {textOnly:true}).
//
// A pure prose turn does not need tool definitions, and a local brain pays for
// every one of them in its prompt (116 tools = a large, slow prompt for a 26B
// model). A text-only run asks the claude CLI for NO tools at all:
//   --tools ""            disables every built-in tool (CLI 2.1.283)
//   --strict-mcp-config   ignores every MCP config that is not passed explicitly,
//                         and none is passed — so no MCP servers, incl. user/connector MCP
// and drops --allowedTools, --mcp-config and the native-skills --add-dir.
// Everything else (--settings, --resume, brain/model args) is kept, in order.
//
// Pure helpers only, so they are unit-testable; server.js just calls them.

// Only the boolean true enables it. "true", 1, null, absent → today's behaviour.
function isTextOnly(body) {
  return !!body && body.textOnly === true;
}

// Flags that are removed together with their single value.
const DROP_WITH_VALUE = new Set(["--allowedTools", "--mcp-config", "--add-dir", "--tools"]);
const DROP_ALONE = new Set(["--strict-mcp-config"]);

// The local execution backend spawns with shell:true (claude.cmd / claude.exe
// resolve through the shell). Node then JOINS the argv with spaces and no quoting,
// so a bare "" element disappears and --tools would swallow the next flag. On a
// shell-joined command line the empty value must be written as a literal "" — cmd
// and sh both turn that back into one empty argument. docker (argv, no shell) gets
// a real empty string; ssh quotes each element itself (shq("") → '').
function shellJoins(backendKind) {
  return (backendKind || "local") === "local";
}

// args: the claude argv built by runClaude. Returns a NEW array; input untouched.
// opts.backendKind: the execution backend kind ("local" | "docker" | "ssh").
function applyTextOnly(args, opts = {}) {
  const empty = shellJoins(opts.backendKind) ? '""' : "";
  const out = [];
  let placed = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (DROP_WITH_VALUE.has(a)) {
      // --tools goes where --allowedTools was, so the rest keeps its order.
      if (a === "--allowedTools" && !placed) { out.push("--tools", empty, "--strict-mcp-config"); placed = true; }
      i++;              // skip its value
      continue;
    }
    if (DROP_ALONE.has(a)) continue;
    out.push(a);
  }
  if (!placed) out.push("--tools", empty, "--strict-mcp-config");
  return out;
}

module.exports = { isTextOnly, applyTextOnly, shellJoins };
