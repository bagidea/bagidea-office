"use strict";
// ---------------------------------------------------------------------------
// Built-in Anthropic ↔ OpenAI translation proxy (zero-dep, Node global fetch).
//
// Lets OpenAI/Gemini back an agent WITHOUT running LiteLLM: the daemon exposes
//   POST /proxy/openai/v1/messages   and   /proxy/gemini/v1/messages
// `claude` (with ANTHROPIC_BASE_URL → one of those) sends Anthropic Messages API
// requests here; we translate to OpenAI Chat Completions, call the upstream with
// the user's existing main key (reg.apiKeys.OPENAI_API_KEY / GEMINI_API_KEY),
// and translate the reply back — streaming (SSE) + tool-use included.
//
// Gemini is reached via Google's OpenAI-compatible endpoint, so ONE translator
// serves both. The real key never reaches the sandbox; it's injected here.
// ---------------------------------------------------------------------------

const fs = require("fs");
const path = require("path");
const LOG = path.join(__dirname, "proxy.log");
// Lightweight per-call log (auto-truncated) so provider failures are diagnosable.
function plog(line) {
  try {
    try { if (fs.statSync(LOG).size > 250000) fs.writeFileSync(LOG, ""); } catch {}
    fs.appendFileSync(LOG, line + "\n");
  } catch {}
}

const UPSTREAM = {
  openai: { url: "https://api.openai.com/v1/chat/completions", key: "OPENAI_API_KEY",
            fallbackModel: "gpt-4o-mini" },
  gemini: { url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            key: "GEMINI_API_KEY", fallbackModel: "gemini-2.5-flash" },
  openrouter: { url: "https://openrouter.ai/api/v1/chat/completions", fallbackModel: "" },
  nvidia: { url: "https://integrate.api.nvidia.com/v1/chat/completions", fallbackModel: "" },
  groq: { url: "https://api.groq.com/openai/v1/chat/completions", fallbackModel: "llama-3.3-70b-versatile" },
  cerebras: { url: "https://api.cerebras.ai/v1/chat/completions", fallbackModel: "llama-3.3-70b" },
  xai: { url: "https://api.x.ai/v1/chat/completions", fallbackModel: "" },
  mistral: { url: "https://api.mistral.ai/v1/chat/completions", fallbackModel: "mistral-large-latest" },
  together: { url: "https://api.together.xyz/v1/chat/completions", fallbackModel: "" },
  fireworks: { url: "https://api.fireworks.ai/inference/v1/chat/completions", fallbackModel: "" },
  // Local OpenAI-compatible servers — no key needed (auth ignored). Default ports;
  // a non-default port needs a Custom provider with an explicit Base URL.
  ollama: { url: "http://127.0.0.1:11434/v1/chat/completions", fallbackModel: "", local: true },
  lmstudio: { url: "http://127.0.0.1:1234/v1/chat/completions", fallbackModel: "", local: true },
};

// Resolve the OpenAI-compatible upstream for a provider. An explicit
// reg.providerConfig[provider].baseUrl (a `/v1`-style base — used by OpenRouter,
// NVIDIA, and any custom provider) wins; otherwise the built-in default URL.
// Key: providerConfig.token first, else the built-in main-key env (openai/gemini).
function upstreamFor(provider, reg) {
  const pc = (reg.providerConfig || {})[provider] || {};
  const up = UPSTREAM[provider] || {};
  const chat = pc.baseUrl ? pc.baseUrl.replace(/\/+$/, "") + "/chat/completions" : up.url;
  // Local servers (Ollama/LM Studio) ignore auth — synthesize a placeholder so the
  // "key not set" guards pass without the user pasting anything.
  const key = pc.token || (up.key && (reg.apiKeys || {})[up.key]) || (up.local ? "local" : "");
  const models = chat ? chat.replace(/\/chat\/completions$/, "/models") : "";
  return { chat, models, key, fallbackModel: pc.model || up.fallbackModel || "" };
}

const STOP = { stop: "end_turn", length: "max_tokens", tool_calls: "tool_use", content_filter: "end_turn" };

// --- Gemini thought signatures --------------------------------------------
// Gemini thinking models attach a `thought_signature` to each tool call
// (tool_calls[].extra_content.google.thought_signature on the OpenAI-compat
// endpoint) and REQUIRE it echoed back on that tool call when the conversation
// history returns — otherwise the next turn 400s with "Function call is
// missing a thought_signature in functionCall parts". The signature can't ride
// through claude's Anthropic-format history (unknown fields don't round-trip),
// so we remember it here keyed by tool_call id and re-attach on the way out.
// For history whose signature we never saw (daemon restart, pre-fix session),
// Google documents the dummy `skip_thought_signature_validator` as the escape
// hatch. Only used when talking to Gemini — other providers reject unknown
// message fields.
const SIG_DUMMY = "skip_thought_signature_validator";
const SIG_MAX = 4000;                 // ids are ~short; this is a few hundred KB worst-case
const SIG_CACHE = new Map();          // tool_call id → thought_signature (insertion-ordered)
function sigRemember(id, sig, cache) {
  if (!id || !sig) return;
  const c = cache || SIG_CACHE;
  if (c.size >= SIG_MAX && !c.has(id)) c.delete(c.keys().next().value); // drop oldest
  c.set(id, sig);
}

// --- Anthropic request → OpenAI Chat Completions request (pure, testable) ----
// opts.gemini: attach remembered (or dummy) thought signatures to tool_calls.
// opts.sigs:   signature cache override (tests) — defaults to the module cache.
function toOpenAI(a, model, opts) {
  const msgs = [];
  if (a.system) {
    const sys = typeof a.system === "string"
      ? a.system
      : a.system.map((b) => (b && b.text) || "").join("\n");
    if (sys) msgs.push({ role: "system", content: sys });
  }
  for (const m of a.messages || []) {
    if (typeof m.content === "string") { msgs.push({ role: m.role, content: m.content }); continue; }
    const parts = [], toolCalls = [], toolResults = [];
    for (const b of m.content || []) {
      if (b.type === "text") parts.push({ type: "text", text: b.text || "" });
      else if (b.type === "image" && b.source) {
        const s = b.source;
        const url = s.type === "base64" ? `data:${s.media_type};base64,${s.data}` : s.url;
        if (url) parts.push({ type: "image_url", image_url: { url } });
      } else if (b.type === "tool_use") {
        const tc = { id: b.id, type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input || {}) } };
        if (opts && opts.gemini) {
          const sig = (opts.sigs || SIG_CACHE).get(b.id) || SIG_DUMMY;
          tc.extra_content = { google: { thought_signature: sig } };
        }
        toolCalls.push(tc);
      } else if (b.type === "tool_result") {
        let c = b.content;
        if (Array.isArray(c)) c = c.map((x) => (x && x.type === "text" ? x.text : JSON.stringify(x))).join("\n");
        else if (typeof c !== "string") c = JSON.stringify(c == null ? "" : c);
        toolResults.push({ role: "tool", tool_call_id: b.tool_use_id, content: c || "" });
      }
    }
    if (m.role === "user") {
      for (const tr of toolResults) msgs.push(tr);          // tool replies first
      if (parts.length) {
        const onlyText = parts.every((p) => p.type === "text");
        msgs.push({ role: "user", content: onlyText ? parts.map((p) => p.text).join("\n") : parts });
      }
    } else {
      const am = { role: "assistant" };
      const txt = parts.filter((p) => p.type === "text").map((p) => p.text).join("");
      if (txt) am.content = txt;
      if (toolCalls.length) am.tool_calls = toolCalls;
      if (!am.content && !am.tool_calls) am.content = "";
      msgs.push(am);
    }
  }
  const out = { model, messages: msgs, stream: !!a.stream };
  if (a.max_tokens) out.max_tokens = a.max_tokens;
  if (a.stream) out.stream_options = { include_usage: true };
  if (Array.isArray(a.tools) && a.tools.length) {
    out.tools = a.tools
      .filter((t) => t && t.name && t.input_schema)
      .map((t) => ({ type: "function",
        function: { name: t.name, description: t.description || "", parameters: t.input_schema } }));
    const tc = a.tool_choice;
    if (tc && tc.type === "auto") out.tool_choice = "auto";
    else if (tc && tc.type === "any") out.tool_choice = "required";
    else if (tc && tc.type === "tool" && tc.name) out.tool_choice = { type: "function", function: { name: tc.name } };
  }
  return out;
}

// --- OpenAI non-streaming response → Anthropic message (pure, testable) ------
// opts.sigs: signature cache override (tests) — defaults to the module cache.
function toAnthropic(o, model, opts) {
  const choice = (o.choices || [])[0] || {};
  const msg = choice.message || {};
  const content = [];
  if (msg.content) content.push({ type: "text", text: msg.content });
  for (const tc of msg.tool_calls || []) {
    let input = {};
    try { input = JSON.parse((tc.function && tc.function.arguments) || "{}"); } catch {}
    // Gemini thinking models sign each tool call; remember the signature so the
    // history echo (toOpenAI) can re-attach it — required, or next turn 400s.
    const sig = tc.extra_content && tc.extra_content.google &&
                tc.extra_content.google.thought_signature;
    if (sig) sigRemember(tc.id, sig, opts && opts.sigs);
    content.push({ type: "tool_use", id: tc.id, name: tc.function && tc.function.name, input });
  }
  return {
    id: o.id || "msg_proxy", type: "message", role: "assistant", model, content,
    stop_reason: STOP[choice.finish_reason] || "end_turn", stop_sequence: null,
    usage: { input_tokens: (o.usage || {}).prompt_tokens || 0,
             output_tokens: (o.usage || {}).completion_tokens || 0 },
  };
}

function sse(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }

// Resolve the model to forward: ignore claude-* (means --model didn't apply) and
// blanks, falling back to a safe widely-available model per upstream.
function pickModel(reqModel, fallback) {
  const m = String(reqModel || "");
  return (!m || /^claude/i.test(m)) ? (fallback || m) : m;
}

// Models that can't back a TEXT agent (image/audio/embedding/realtime/etc.) — drop
// them from the pickers. Also strip Gemini's "models/" id prefix (the OpenAI-compat
// chat endpoint wants the bare id, while /models lists them prefixed).
const NON_CHAT_MODEL = /(image|tts|audio|speech|whisper|transcri|embedding|\bembed\b|moderation|rerank|guard|safety|dall|imagen|veo|sora|-live\b|realtime|\bclip\b|bison|gecko)/i;
function cleanModels(ids) {
  const norm = (ids || []).map((id) => String(id).replace(/^models\//, "")).filter(Boolean);
  const chat = norm.filter((id) => !NON_CHAT_MODEL.test(id));
  const src = chat.length ? chat : norm;   // never return empty if everything filtered
  const seen = new Set(), out = [];
  for (const id of src) if (!seen.has(id)) { seen.add(id); out.push(id); }
  return out;
}

// Synthesise an Anthropic SSE stream from a COMPLETE translated message. We buffer
// the upstream (no live SSE delta translation — that was fragile across providers)
// then replay it as the exact Anthropic event sequence claude expects.
function streamAnthropic(res, msg) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const u = msg.usage || {};
  sse(res, "message_start", { type: "message_start", message: {
    id: msg.id, type: "message", role: "assistant", model: msg.model, content: [],
    stop_reason: null, stop_sequence: null,
    usage: { input_tokens: u.input_tokens || 0, output_tokens: 0,
      cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
  (msg.content || []).forEach((block, i) => {
    if (block.type === "text") {
      sse(res, "content_block_start", { type: "content_block_start", index: i, content_block: { type: "text", text: "" } });
      if (block.text) sse(res, "content_block_delta", { type: "content_block_delta", index: i, delta: { type: "text_delta", text: block.text } });
      sse(res, "content_block_stop", { type: "content_block_stop", index: i });
    } else if (block.type === "tool_use") {
      sse(res, "content_block_start", { type: "content_block_start", index: i, content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } });
      sse(res, "content_block_delta", { type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: JSON.stringify(block.input || {}) } });
      sse(res, "content_block_stop", { type: "content_block_stop", index: i });
    }
  });
  sse(res, "message_delta", { type: "message_delta", delta: { stop_reason: msg.stop_reason || "end_turn", stop_sequence: null }, usage: { output_tokens: u.output_tokens || 0 } });
  sse(res, "message_stop", { type: "message_stop" });
  res.end();
}

async function handle(req, res, provider, reg, raw) {
  const errOut = (status, type, message, headers) => {
    plog(`  ERR ${status} ${type}: ${String(message).slice(0, 280)}`);
    try {
      res.writeHead(status, { "content-type": "application/json", ...(headers || {}) });
      res.end(JSON.stringify({ type: "error", error: { type, message } }));
    } catch {}
  };
  const { chat, key, fallbackModel } = upstreamFor(provider, reg);
  if (!chat) return errOut(404, "not_found_error", `no endpoint configured for provider "${provider}"`);
  if (!key) return errOut(400, "authentication_error", `key not set for "${provider}" — add it in ⚙ CONNECT`);
  let a;
  try { a = JSON.parse(raw); } catch { return errOut(400, "invalid_request_error", "bad json"); }

  let model = pickModel(a.model, fallbackModel);
  model = model.replace(/^models\//, "");   // Gemini ids: chat endpoint wants the bare id
  // No usable model resolved (blank, or claude-* leaked through for a provider with
  // no default) → tell the user plainly instead of 400-ing the upstream cryptically.
  if (!model || /^claude/i.test(model))
    return errOut(400, "invalid_request_error",
      `no model set for "${provider}" — pick or type a model in the agent's 🧠 BRAIN field` +
      (provider === "openrouter" || provider === "nvidia" ? ` (use vendor/model form, e.g. openai/gpt-4o)` : ""));

  // Built-in gemini provider OR a custom provider pointed at Google's endpoint —
  // both need thought signatures round-tripped (and reject nothing extra).
  const isGemini = provider === "gemini" || /generativelanguage\.googleapis\.com/.test(chat);
  const body = toOpenAI(a, model, { gemini: isGemini });
  // Buffer the upstream (no live SSE translation) for reliability across providers.
  body.stream = false;
  delete body.stream_options;
  // Claude Code sends Anthropic-sized max_tokens (often 32k); most OpenAI-compat
  // chat models cap completion at 16k → pre-clamp to avoid a guaranteed 400.
  if (body.max_tokens && body.max_tokens > 16384) body.max_tokens = 16384;
  plog(`[${new Date().toISOString().slice(11, 19)}] ${provider} model=${model} stream=${!!a.stream} msgs=${(body.messages || []).length} tools=${(body.tools || []).length} max=${body.max_tokens || "-"} → ${chat}`);

  // Cancel the upstream only if claude drops before we finish (real task cancel).
  const ac = new AbortController();
  res.on("close", () => { if (!res.writableEnded) { try { ac.abort(); } catch {} } });

  // Hard upstream cap (issue #15, Bug 2): without it a hung upstream is held open
  // forever and the CLI's ~60s retry loop turns one bad turn into a storm.
  const PROXY_TIMEOUT_MS = 120000;
  const doFetch = () => fetchWithTimeout(chat, { method: "POST", signal: ac.signal,
    headers: { "content-type": "application/json", authorization: "Bearer " + key,
      "HTTP-Referer": "https://github.com/bagidea/bagidea-office", "X-Title": "BagIdea Office" },
    body: JSON.stringify(body) }, PROXY_TIMEOUT_MS);

  let r;
  try { r = await doFetch(); }
  catch (e) {
    if (ac.signal.aborted) return;   // cancelled — nothing to send
    return errOut(502, "api_error", "upstream fetch failed: " + (e && e.message));
  }

  // One-shot self-heal for the param rejections OpenAI-compat providers throw most
  // (newer models want max_completion_tokens; some cap max_tokens lower; some pin
  // temperature). Adjust the offending field and retry once before giving up.
  if (!r.ok && (r.status === 400 || r.status === 422)) {
    const txt = await r.text().catch(() => "");
    let fix = "";
    if (/max_completion_tokens/i.test(txt) && body.max_tokens != null) {
      body.max_completion_tokens = body.max_tokens; delete body.max_tokens; fix = "max_completion_tokens";
    } else if (/max_tokens/i.test(txt) && /(too large|maximum|at most|less than|support|exceed)/i.test(txt) && body.max_tokens) {
      body.max_tokens = 4096; fix = "max_tokens=4096";
    } else if (/temperature/i.test(txt) && body.temperature != null) {
      delete body.temperature; fix = "drop temperature";
    }
    if (!fix) return errOut(r.status, "api_error", (txt || `upstream HTTP ${r.status}`).slice(0, 600));
    plog(`  retry (${fix}) after 400: ${txt.slice(0, 160)}`);
    try { r = await doFetch(); }
    catch (e) {
      if (ac.signal.aborted) return;
      return errOut(502, "api_error", "upstream fetch failed: " + (e && e.message));
    }
  }
  if (!r.ok) {
    const txt = await r.text().catch(() => "");
    if (r.status === 429) {
      // Distinguish a GENUINELY-too-big request from a TRANSIENT rolling-window limit.
      // OpenAI says "Request too large ... Limit L, Requested N" for BOTH; only N > L
      // means the single request can never fit (retry is futile → non-retryable 400,
      // which triggers office compaction/recovery). N <= L is just the per-minute
      // window temporarily full → pass the 429 through so claude backs off and retries.
      const m = txt.match(/Limit\s+(\d+).*?Requested\s+(\d+)/i);
      const limit = m ? +m[1] : 0, need = m ? +m[2] : 0;
      if (need && limit && need > limit) {
        return errOut(400, "invalid_request_error",
          `${provider}/${model}: this request (~${need} tokens) is larger than your account's ` +
          `${limit} tokens/min limit, so it can never fit. Raise this provider's tier (or add ` +
          `billing), or run this agent on a model with larger limits (Claude / GLM / DeepSeek).`);
      }
      const ra = r.headers.get("retry-after");
      return errOut(429, "rate_limit_error",
        (txt || "rate limited — backing off and retrying").slice(0, 400),
        ra ? { "retry-after": ra } : null);
    }
    return errOut(r.status, "api_error", (txt || `upstream HTTP ${r.status}`).slice(0, 600));
  }
  let j;
  try { j = await r.json(); } catch { return errOut(502, "api_error", "upstream returned non-JSON"); }
  // Some gateways (OpenRouter) answer 200 with an error object in the body.
  if (j && j.error) return errOut(502, "api_error", String(j.error.message || JSON.stringify(j.error)).slice(0, 600));

  const finish = (j.choices && j.choices[0] && j.choices[0].finish_reason) || "?";
  const msg = toAnthropic(j, model);
  plog(`  ok status=${r.status} finish=${finish} blocks=${msg.content.length}`);
  if (!msg.content.length) {
    // Empty/odd reply → surface it (and log the raw body) instead of going silent.
    plog(`  EMPTY body=${JSON.stringify(j).slice(0, 700)}`);
    msg.content.push({ type: "text",
      text: `(proxy: ${provider}/${model} returned no content — finish_reason=${finish})` });
  }
  if (a.stream) streamAnthropic(res, msg);
  else { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(msg)); }
}

// fetch() wrapper with a hard upstream timeout. Without this, a hung upstream
// holds the connection open forever — and since claude CLI retries every ~60s,
// one hung turn becomes an unbounded retry storm (issue #15, Bug 2).
//
// Either the timeout OR an external abort (caller's opts.signal, e.g. the
// Claude child dropping the request) wins; both resolve the same way.
async function fetchWithTimeout(url, opts, timeoutMs) {
  const external = opts && opts.signal;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  // If the caller aborts (client drop), propagate to our fetch immediately.
  // Stored as a named ref so removeEventListener can actually detach it.
  const onAbort = () => ctrl.abort();
  if (external) {
    if (external.aborted) onAbort();
    else external.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const { signal: _drop, ...rest } = opts || {};
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    if (external) external.removeEventListener("abort", onAbort);
  }
}

module.exports = { handle, streamAnthropic, toOpenAI, toAnthropic, pickModel, cleanModels, upstreamFor, UPSTREAM, fetchWithTimeout, SIG_DUMMY };
