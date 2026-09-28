"use strict";
// Claude CLI env for a LOCAL brain behind the in-process proxy (lmstudio/ollama/custom
// localhost). Pure, unit-testable; server.js applies it only when the route is local.
//
// 1) Timeouts. The proxy buffers the upstream (stream=false), so the CLI sees no headers
//    and no bytes until the local model is done. The CLI has three JS-level clocks:
//    API_TIMEOUT_MS (SDK timeout, default 600000 in 2.1.283), the first-byte window and
//    the stream-idle watchdog. Under them sits the Bun runtime's own HTTP-client idle
//    timeout (BUN_CONFIG_HTTP_IDLE_TIMEOUT, in SECONDS): the native CLI only turns it off
//    for first-party routes, so on a proxy route it closes a silent request at ~360 s
//    whatever the three env limits say (T1-c 04:00, repro workspace/tmp/jojo-360).
//    Put all four just above the proxy cap, so the proxy's own clear error arrives
//    first and the daemon watchdog (cap + 60 s) stays the outermost layer.
// 2) Auto-memory. Claude Code's auto-memory system prompt section and the pinned
//    memory/index attachments are Claude-agent context; a local prose model echoes them
//    (run 9 ch3b: "From a previously saved memory ... `bun test`").
//    CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 turns the feature off for this spawn only.
const CLIENT_MARGIN_MS = 30000;
function localClientEnv(env, proxyCapMs) {
  const cap = Number(proxyCapMs);
  if (!Number.isFinite(cap) || cap <= 0) return env;
  const want = Math.floor(cap) + CLIENT_MARGIN_MS;
  const keep = (k) => { const n = Number(env[k]); return Number.isFinite(n) && n > want ? String(Math.floor(n)) : String(want); };
  const wantS = Math.ceil(want / 1000);
  const bunS = Number(env.BUN_CONFIG_HTTP_IDLE_TIMEOUT);
  return { ...env,
    API_TIMEOUT_MS: keep("API_TIMEOUT_MS"),
    CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS: keep("CLAUDE_STREAM_FIRST_BYTE_TIMEOUT_MS"),
    CLAUDE_STREAM_IDLE_TIMEOUT_MS: keep("CLAUDE_STREAM_IDLE_TIMEOUT_MS"),
    BUN_CONFIG_HTTP_IDLE_TIMEOUT: Number.isFinite(bunS) && bunS > wantS ? String(Math.floor(bunS)) : String(wantS),
    CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
}
module.exports = { localClientEnv, CLIENT_MARGIN_MS };
