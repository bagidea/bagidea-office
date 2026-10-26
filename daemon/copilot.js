"use strict";
// ---------------------------------------------------------------------------
// 🧠 Shino copilot core — every "help me write this" job in the office runs HERE:
// ✨ the persona copilot (Create / Edit Agent), 🪄 workflow draft and 🔍 workflow
// analyze (Workflow Builder), and whatever comes next. The job
// is done by the Director (reg.agents.main — its real name is read live, "Shino" in
// most offices) on the Provider + Model the OWNER picked for copilot work:
//
//   reg.copilot = { provider, model }     provider "" / "director" / unset → follow
//                                          the Director's own brain (provider/model)
//
// Every call is ONE-SHOT: it never queues behind the Director's other work and never
// touches the Director's chat threads. Two execution paths:
//   • OpenAI-compatible providers (openai, gemini, openrouter, … lmstudio / ollama,
//     custom kind "openai") → a direct POST <upstreamFor(provider).chat> with
//     { model, messages:[system, user], temperature 0.3, max_tokens } under an
//     AbortController timeout. The key rides in the Authorization header only.
//   • claude + Anthropic-compatible providers (glm, deepseek, qwen, minimax, moonshot,
//     kimicode, custom kind "anthropic") → the injected claudeText(prompt, { provider,
//     model }): `claude -p` routed by providers.resolve (tokens through env, never argv;
//     the prompt through stdin). The system text is prepended to the prompt.
//
// json:true → the first JSON object/array of the reply (fenced or bare) is parsed; one
// retry with a "valid JSON only" nudge; still unreadable → error BAD_JSON.
// Error codes: NOT_CONNECTED · AUTH (401/403) · MODEL_NOT_FOUND (404 / "model … not
// found") · TIMEOUT · NETWORK · EMPTY · BAD_JSON · UPSTREAM (any other HTTP error). Each
// comes with a readable Thai message plus the raw detail — redacted, never a key, and
// prompts are never logged.
// track:{ title } → task.started / task.completed|failed for agent "main", so the office
// shows the Director working while the copilot thinks.
//
// server.js wires it once:  const shinoCopilot = require("./copilot").init({ getReg: () => reg,
//   saveReg, claudeText, broadcast, upstreamFor: proxy.upstreamFor })
// and any other module can use  require("./copilot").get()  (null before init).
// ---------------------------------------------------------------------------

const providers = require("./providers");
const fallback = require("./fallback");
const { cleanModels } = require("./proxy");

const CODES = Object.freeze(["NOT_CONNECTED", "AUTH", "MODEL_NOT_FOUND", "TIMEOUT", "NETWORK", "EMPTY", "BAD_JSON", "UPSTREAM"]);
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MAX_TOKENS = 4096;
const MAX_TOKENS_CAP = 16384;          // same clamp as the office proxy (most OpenAI-compat models stop there)
const TEMPERATURE = 0.3;
// Local servers (LM Studio / Ollama) often run reasoning models (Qwen3, Agents-A1 …) that
// think before they answer — in testing Agents-A1 spent a whole 1,500-token budget
// thinking (finish_reason=length, empty reply). Tokens cost nothing there: a local brain always
// gets at least LOCAL_MIN_TOKENS, and a caller's localTimeoutMs (the time to think at ~40 tok/s).
const LOCAL_MIN_TOKENS = 8192;
const ID_RE = /^[a-z0-9][\w.-]{0,63}$/i;   // the provider-id shape fallback.js accepts
const LOCAL_LABEL = { ollama: "Ollama · local", lmstudio: "LM Studio · local" };
// What the Director is doing, for the system prompt (an unknown job is named as given).
const JOBS = {
  persona: "designing a new teammate's persona, skills and tools (✨ persona copilot)",
  "workflow-draft": "drafting a workflow from the owner's goal (🪄 Workflow Builder)",
  "workflow-analyze": "reviewing a workflow the owner drew and planning how to make it real (🔍 Workflow Builder)",
};
const NUDGE = "Your previous reply could not be parsed as JSON. Reply again with ONLY the JSON the request asks for: " +
  "valid JSON (double-quoted keys and strings, no comments, no trailing commas), no markdown fences, no text before or after it.";
const NOT_CHAT_LOCAL = /mmproj|embed|rerank|whisper|clip-/i;   // LM Studio also lists projector / embedding files
const MODEL_MISSING = /\bmodel\b[^.\n]{0,100}?\b(not found|does not exist|doesn't exist|not exist|no such|not loaded|not available)\b|model_not_found|no models? (are |is )?loaded|unknown model|invalid model/i;
const AUTH_TEXT = /invalid[ _]api[ _]key|incorrect api key|unauthori[sz]ed|authentication_error|invalid bearer token|permission_denied/i;
const CONTEXT_FULL = /context (length|window|size)|maximum context|too many tokens|n_ctx|prompt is too long|exceeds? the (model'?s? )?(context|max)/i;

const own = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
const oneLine = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
const clip = (v, n) => { const s = String(v == null ? "" : v).trim(); return s.length > n ? s.slice(0, n).trimEnd() + " …" : s; };
const specOf = (id) => (own(providers.PROVIDERS, id) ? providers.PROVIDERS[id] : null);
const pcOf = (reg, id) => {
  const pcs = reg && reg.providerConfig;
  return own(pcs, id) && pcs[id] && typeof pcs[id] === "object" ? pcs[id] : {};
};
const isLocal = (id) => fallback.isLocal(id, providers.PROVIDERS);
const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(hi, Math.max(lo, n)) : dflt; };
const originOf = (u) => { try { return new URL(u).origin; } catch { return ""; } };

// ---- providers: label · kind · group ----------------------------------------
function providerLabel(id, reg) {
  const spec = specOf(id);
  if (spec && spec.label) return spec.label;
  if (own(LOCAL_LABEL, id)) return LOCAL_LABEL[id];
  const pc = pcOf(reg, id);
  return pc.label ? oneLine(pc.label, 40) + " · custom" : String(id || "?");
}
// "claude" (the CLI on the machine's own login) · "anthropic" (claude -p pointed at an
// Anthropic-compatible endpoint) · "openai" (a direct HTTP call) · null (unknown).
function kindOf(id, reg) {
  if (id === "claude") return "claude";
  const spec = specOf(id);
  if (spec) return spec.format === "openai" ? "openai" : "anthropic";
  if (fallback.LOCAL.has(id)) return "openai";
  const k = pcOf(reg, id).kind;
  return k === "openai" || k === "anthropic" ? k : null;
}
function groupOf(id) {
  if (id === "claude") return "claude";
  if (isLocal(id)) return "local";
  return specOf(id) ? "cloud" : "custom";
}

// ---- the Director + the owner's choice ---------------------------------------
function directorOf(reg) {
  const r = reg || {};
  const main = (r.agents && r.agents.main) || {};
  return { id: "main", name: oneLine(main.name, 40) || "Director",
    provider: String(main.provider || r.defaultProvider || "claude"), model: String(main.model || "") };
}
function copilotChoice(reg) {
  const c = reg && reg.copilot && typeof reg.copilot === "object" ? reg.copilot : {};
  let provider = typeof c.provider === "string" ? c.provider.trim() : "";
  if (provider === "director") provider = "";
  return { provider, model: provider && typeof c.model === "string" ? c.model.trim() : "" };
}

// ---- JSON out of a model reply -----------------------------------------------
// Index of the bracket closing the one at s[i] (strings and escapes respected), or -1.
function closeOf(s, i) {
  const stack = [];
  let inStr = false, esc = false;
  for (let k = i; k < s.length; k++) {
    const ch = s[k];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return -1;
      if (!stack.length) return k;
    }
  }
  return -1;
}
function parseLoose(s) {
  try { return JSON.parse(s); } catch {}
  const t = s.replace(/,\s*([}\]])/g, "$1");     // the slip models make most: trailing commas
  if (t !== s) { try { return JSON.parse(t); } catch {} }
  return undefined;
}
// "[1]" / "[2, 3]" in prose are citations, not the answer.
const usable = (v) => !!v && typeof v === "object" && !(Array.isArray(v) && v.every((x) => typeof x === "number"));
function scanFirst(s) {
  for (let i = 0, tries = 0; i < s.length && tries < 60; i++) {
    const ch = s[i];
    if (ch !== "{" && ch !== "[") continue;
    tries++;
    const end = closeOf(s, i);
    if (end < 0) continue;
    const v = parseLoose(s.slice(i, end + 1));
    if (usable(v)) return v;
  }
  return null;
}
// The first JSON object/array in `text`: a ```json fenced block wins, else the first
// bare one. null when there is none.
function extractJson(text) {
  const s = String(text == null ? "" : text);
  if (!s.trim()) return null;
  const fence = /```[ \t]*[\w-]*[ \t]*\r?\n?([\s\S]*?)```/g;
  let m;
  while ((m = fence.exec(s))) {
    const body = m[1].trim();
    if (!body) continue;
    const v = parseLoose(body);
    if (usable(v)) return v;
    const inner = scanFirst(body);
    if (inner) return inner;
  }
  return scanFirst(s);
}
// Reasoning models (Qwen3 & co. on LM Studio / Ollama) may put their thinking in the
// content: drop <think>…</think>; a reply cut off while still thinking is empty.
function stripThink(t) {
  let s = String(t == null ? "" : t).replace(/<(think|thinking|reasoning)>[\s\S]*?<\/\1>/gi, "");
  if (/^\s*<(think|thinking|reasoning)>/i.test(s)) return "";
  const close = s.search(/<\/(think|thinking)>/i);      // template put the opening tag in the prompt
  if (close >= 0) s = s.slice(s.indexOf(">", close) + 1);
  return s.trim();
}
function contentText(c) {
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === "string" ? p : (p && (p.text || p.content)) || "")).join("");
  return "";
}

// ---- errors ------------------------------------------------------------------
function classifyHttp(status, text) {
  const t = String(text || "");
  if (status === 401 || status === 403) return "AUTH";
  if (status === 404) return "MODEL_NOT_FOUND";
  if (status === 408 || status === 504) return "TIMEOUT";
  if (!status && AUTH_TEXT.test(t)) return "AUTH";
  if (status !== 429 && MODEL_MISSING.test(t)) return "MODEL_NOT_FOUND";
  return "UPSTREAM";
}
// `claude -p` prints its own failures as the reply ("API Error: 401 …", "Invalid API
// key · Please run /login"). Only a SHORT reply that starts like that counts.
function cliError(text) {
  const t = String(text || "").trim();
  if (!t || t.length > 1500) return null;
  const first = t.split("\n", 1)[0];
  const m = first.match(/^API Error:\s*(\d{3})\b/i);
  if (m) return classifyHttp(Number(m[1]), t);
  if (/^(Invalid API key|Invalid bearer token|OAuth token has expired|Please run \/login|Not logged in|Authentication failed)/i.test(first)) return "AUTH";
  if (/^(API Error:.*\b(timed? ?out|timeout)\b|Request timed out)/i.test(first)) return "TIMEOUT";
  if (/^API Error:.*\b(Connection error|ECONNREFUSED|ENOTFOUND|fetch failed)/i.test(first)) return "NETWORK";
  if (/^(API Error\b|Credit balance is too low)/i.test(first)) return "UPSTREAM";
  return null;
}
function readableMessage(code, L, x) {
  const w = x || {};
  switch (code) {
    case "NOT_CONNECTED": return `${L} is not usable yet — ${w.why || "not connected"} (set it up in ⚙ CONNECT)`;
    case "AUTH": return `${L} rejected the key${w.status ? " (HTTP " + w.status + ")" : ""} — check the key in ⚙ CONNECT`;
    case "MODEL_NOT_FOUND": return w.why || (w.status === 404
      ? `${L} answered 404 — model "${w.model || "?"}" not found, or the provider URL is wrong`
      : `Model "${w.model || "?"}" not found on ${L} — pick another model or load this one first`);
    case "TIMEOUT": return `${L} did not answer within ${Math.round((w.ms || 0) / 1000)} s`;
    case "NETWORK": return `Cannot reach ${L}${w.url ? " (" + w.url + ")" : ""} — is the server running / is the internet up?`;
    case "EMPTY": return w.why || `${L} sent back an empty reply`;
    case "BAD_JSON": return `${L} did not reply with readable JSON (tried twice) — try a stronger model`;
    default: return w.why || `${L} answered with an error${w.status ? " (HTTP " + w.status + ")" : ""}`;
  }
}
const bad = (code, x, detail, model, text) => ({ ok: false, code, x: x || {}, detail: detail || "", model, text: text || "" });
// An empty reply cut at max_tokens: the model was still thinking (reasoning_content / <think>).
const thoughtTooLong = (a) => a && a.code === "EMPTY" && /finish_reason=length/.test(String(a.detail || ""));

// OpenAI-compatible providers reject a few params per model family — adjust the
// offending one and retry (same one-shot self-heal as the office proxy). A local server
// may refuse prompt + max_tokens > its context length and says by how much: shrink to fit.
function paramFix(body, raw) {
  const t = String(raw || "");
  const key = body.max_tokens != null ? "max_tokens" : body.max_completion_tokens != null ? "max_completion_tokens" : "";
  const ctxLen = t.match(/maximum context length is (\d+)/i);
  const input = t.match(/(\d+) (?:tokens )?in the messages|request has (\d+) input tokens|(\d+) input tokens/i);
  if (key && ctxLen && input) {
    const left = Number(ctxLen[1]) - Number(input[1] || input[2] || input[3]) - 16;
    if (left >= 128 && left < body[key]) { body[key] = left; return true; }
  }
  if (/max_completion_tokens/i.test(t) && body.max_tokens != null) {
    body.max_completion_tokens = body.max_tokens; delete body.max_tokens; return true;
  }
  if (/max_tokens/i.test(t) && /(too large|maximum|at most|less than|support|exceed)/i.test(t) && body.max_tokens > 4096) {
    body.max_tokens = 4096; return true;
  }
  if (/temperature/i.test(t) && body.temperature != null) { delete body.temperature; return true; }
  return false;
}

// ---- office context (for the analyze prompt) ----------------------------------
// Compact: agent ids + names + roles (never the owner's avatar "ceo"), skill ids with a
// one-line description (library/owner skills first, learned lessons after; ids only once
// the budget is spent), builtin tool names and MCP servers.
function officeContext(reg, o = {}) {
  const r = reg || {};
  const budget = o.maxChars || 7000;
  const descLen = o.descLen || 90;
  const agents = Object.entries(r.agents || {}).filter(([id, a]) => id !== "ceo" && a && typeof a === "object")
    .map(([id, a]) => `- ${id}: ${oneLine(a.name || id, 40)} — ${oneLine(a.role || "", 60) || "?"}`);
  const skills = Object.entries(r.skills || {}).filter(([, s]) => s && typeof s === "object")
    .sort(([, a], [, b]) => (a.auto ? 1 : 0) - (b.auto ? 1 : 0));
  const lines = [];
  let used = agents.join("\n").length, rest = [];
  for (const [id, s] of skills) {
    const line = `- ${id}: ${oneLine(s.description || s.name || "", descLen)}`;
    if (used + line.length > budget) { rest.push(id); continue; }
    lines.push(line); used += line.length + 1;
  }
  if (rest.length) {
    let ids = "";
    for (const id of rest) { if (ids.length + id.length > 1500) { ids += `, … (+${rest.length - ids.split(", ").length} more)`; break; } ids += (ids ? ", " : "") + id; }
    lines.push(`- more skills (ids only): ${ids}`);
  }
  const tools = (Array.isArray(o.tools) ? o.tools : []).map(String).filter(Boolean);
  const mcp = Object.keys(r.mcpServers || {}).map((n) => "mcp:" + n);
  return [
    "OFFICE CONTEXT — name agents, skills and tools ONLY by these real ids (if nothing fits, say what new skill or agent to create):",
    "Agents (id: name — role):", ...(agents.length ? agents : ["- (none)"]),
    "Skills (id: what it does):", ...(lines.length ? lines : ["- (none yet)"]),
    "Built-in tools: " + (tools.join(", ") || "(none)"),
    ...(mcp.length ? ["MCP tools: " + mcp.join(", ")] : []),
  ].join("\n");
}

// ---- the instance ------------------------------------------------------------
let taskSeq = 0;
function create(deps = {}) {
  const getReg = typeof deps.getReg === "function" ? deps.getReg : () => ({});
  const saveReg = typeof deps.saveReg === "function" ? deps.saveReg : () => {};
  const claudeText = typeof deps.claudeText === "function" ? deps.claudeText : async () => "";
  const broadcast = typeof deps.broadcast === "function" ? deps.broadcast : () => {};
  const upstreamFor = typeof deps.upstreamFor === "function" ? deps.upstreamFor : require("./proxy").upstreamFor;
  const fetchImpl = typeof deps.fetchImpl === "function" ? deps.fetchImpl : (...a) => globalThis.fetch(...a);
  const localStatus = typeof deps.localStatus === "function" ? deps.localStatus
    : (r) => fallback.localStatus(r, deps.fetchImpl ? { fetch: deps.fetchImpl } : {});
  const log = typeof deps.log === "function" ? deps.log : (s) => console.log(s);
  const redactor = typeof deps.redact === "function" ? deps.redact : null;
  // slotLane(provider) → the local-model gate for that provider (server.js: localSlots.laneFor),
  // or null when the provider has no cap. onUsage(provider, {in, out}) → cost stats.
  const slotLane = typeof deps.slotLane === "function" ? deps.slotLane : () => null;
  const onUsage = typeof deps.onUsage === "function" ? deps.onUsage : () => {};

  // Raw upstream text → safe to show / log: the office's keys, key shapes, home paths out.
  function redact(text, r, key) {
    let s = String(text == null ? "" : text);
    if (key && key.length >= 6) s = s.split(key).join("[REDACTED]");
    try { s = redactor ? redactor(s, r) : require("./report").redactSecrets(s, { reg: r }); }
    catch { s = s.replace(/\b(sk|hf)[-_][A-Za-z0-9_-]{8,}/g, "[REDACTED]").replace(/(Bearer\s+)\S{8,}/gi, "$1[REDACTED]"); }
    return s;
  }

  // reg.copilot {provider, model} wins; "" / "director" → the Director's own brain.
  function brain(reg) {
    const r = reg || getReg() || {};
    const d = directorOf(r), c = copilotChoice(r);
    const provider = c.provider || d.provider;
    return { provider, model: c.provider ? c.model : d.model, label: providerLabel(provider, r),
      source: c.provider ? "copilot" : "director", directorName: d.name, local: isLocal(provider) };
  }

  function systemText(job, r, extra, json) {
    const d = directorOf(r);
    const main = (r.agents && r.agents.main) || {};
    const px = main.persona && typeof main.persona === "object" ? main.persona : {};
    const out = [
      `You are ${d.name}, the Director of this BagIdea office, acting as the owner's copilot for ${own(JOBS, job) ? JOBS[job] : oneLine(job, 80) || "a request"}.`,
      "The owner asked you directly: do this job yourself, right now, in ONE reply — no tools, no delegating, no follow-up " +
        "questions. Be concrete and practical, and never invent agents, skills, tools or facts the request does not give you.",
    ];
    const lang = oneLine(px.language || main.language, 160);
    if (lang) out.push(`Your usual reply language: ${lang} — unless the request says which language to write in.`);
    const rules = clip(px.rules || main.rules, 500);
    if (rules) out.push("Your standing office rules, for tone and judgement only (the request's own format rules always win):\n" + rules);
    if (extra) out.push(String(extra));
    if (json) out.push("Reply with ONLY valid JSON exactly as the request describes — no prose, no markdown fences.");
    return out.join("\n\n");
  }

  // A blank model on an OpenAI-compatible provider: a local server's first served chat
  // model, else the provider's configured / built-in default, else its catalog hint.
  async function defaultModel(provider, r, up) {
    if (fallback.LOCAL.has(provider)) {
      try {
        const st = await localStatus(r);
        const ids = cleanModels((st && st[provider] && st[provider].models) || []).filter((m) => !NOT_CHAT_LOCAL.test(m));
        if (ids[0]) return ids[0];
      } catch {}
    }
    if (up.fallbackModel) return String(up.fallbackModel);
    const spec = specOf(provider);
    return (spec && (spec.models || []).find(Boolean)) || cleanModels(pcOf(r, provider).models || [])[0] || "";
  }

  async function httpAttempt(ctx, retryText) {
    const { provider, r, label, timeoutMs } = ctx;
    let up = {};
    try { up = upstreamFor(provider, r) || {}; } catch {}
    if (!up.chat) return bad("NOT_CONNECTED", { why: "this provider has no URL yet" });
    if (!up.key) return bad("NOT_CONNECTED", { why: "no key pasted yet" });
    let model = ctx.model;
    if (!model || /^claude/i.test(model)) model = await defaultModel(provider, r, up);
    model = String(model || "").replace(/^models\//, "");
    if (!model) return bad("MODEL_NOT_FOUND", { why: `no model picked for ${label} — pick one in the copilot brain picker` });
    const messages = [{ role: "system", content: ctx.system }, { role: "user", content: ctx.prompt }];
    if (retryText != null) messages.push({ role: "assistant", content: clip(retryText, 6000) || "…" }, { role: "user", content: NUDGE });
    const body = { model, messages, temperature: TEMPERATURE, max_tokens: ctx.maxTokens, stream: false };
    const headers = { "content-type": "application/json", authorization: "Bearer " + up.key,
      "HTTP-Referer": "https://github.com/bagidea/bagidea-office", "X-Title": "BagIdea Office" };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let status = 0, raw = "";
    try {
      for (let fixes = 0; ; fixes++) {
        const resp = await fetchImpl(up.chat, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });
        status = resp.status;
        raw = await resp.text();
        if (resp.ok || fixes >= 2 || (status !== 400 && status !== 422) || !paramFix(body, raw)) break;
      }
    } catch (e) {
      if (ctrl.signal.aborted) return bad("TIMEOUT", { ms: timeoutMs }, "", model);
      const c = (e && e.cause && (e.cause.code || e.cause.message)) || (e && (e.code || e.message)) || String(e);
      return bad("NETWORK", { url: originOf(up.chat) }, redact(c, r, up.key), model);
    } finally { clearTimeout(timer); }
    const detail = () => redact(clip(raw, 500), r, up.key);
    if (status < 200 || status >= 300) {
      const code = classifyHttp(status, raw);
      const why = code === "UPSTREAM" && CONTEXT_FULL.test(raw)
        ? `The request is longer than the context of model "${model}" — raise this model's context length or pick another model`
        : code === "UPSTREAM" && status === 429 ? `${label} hit a rate limit (HTTP 429) — wait a moment and try again` : "";
      return bad(code, { status, model, why }, detail(), model);
    }
    let j = null;
    try { j = JSON.parse(raw); } catch {}
    if (!j || typeof j !== "object") return bad("UPSTREAM", { status, why: `${label} did not answer with chat-API JSON` }, detail(), model);
    if (j.error) {        // some gateways (OpenRouter) answer 200 with an error body
      const em = typeof j.error === "string" ? j.error : JSON.stringify(j.error);
      const st = Number(j.error && (j.error.code || j.error.status)) || 0;
      return bad(classifyHttp(st, em), { status: st || undefined, model }, redact(clip(em, 500), r, up.key), model);
    }
    const ch = (Array.isArray(j.choices) && j.choices[0]) || {};
    if (j.usage && typeof j.usage === "object") {
      try { onUsage(provider, { in: Number(j.usage.prompt_tokens) || 0, out: Number(j.usage.completion_tokens) || 0 }); } catch {}
    }
    const text = stripThink(contentText(ch.message && ch.message.content != null ? ch.message.content : ch.text));
    if (!text) {
      return bad("EMPTY", { why: ch.finish_reason === "length" ? `${label} ran out of max tokens before answering (the model thought too long)` : "" },
        "finish_reason=" + (ch.finish_reason || "?"), model);
    }
    return { ok: true, text, model, finish: ch.finish_reason || "" };
  }

  async function cliAttempt(ctx, retryText) {
    const { provider, r, label, timeoutMs } = ctx;
    let used = ctx.model;
    if (provider !== "claude") {
      // claudeText would quietly fall back to plain Claude for an unconfigured provider.
      let route;
      try { route = providers.resolve(provider, ctx.model, r); } catch { route = { ok: false, reason: "resolve-failed" }; }
      if (!route || !route.ok) {
        return bad("NOT_CONNECTED", { why: route && route.reason === "not-configured" ? "no key or URL yet" : "not connected" },
          String((route && route.reason) || ""));
      }
      if (route.modelArgs && route.modelArgs[1]) used = String(route.modelArgs[1]);
    }
    let prompt = ctx.system + "\n\n---\n\n" + ctx.prompt;
    if (retryText != null) prompt += "\n\n---\n\n" + NUDGE;
    const TIMED_OUT = Symbol("timeout");
    // On timeout the `claude -p` child is killed through the signal — otherwise it would
    // run on to completion, spending tokens for an answer nobody is waiting for.
    const ctrl = new AbortController();
    let timer;
    let out;
    try {
      out = await Promise.race([
        Promise.resolve().then(() => claudeText(prompt, { provider, model: ctx.model, signal: ctrl.signal })).catch(() => ""),
        new Promise((res) => { timer = setTimeout(() => { ctrl.abort(); res(TIMED_OUT); }, timeoutMs); }),
      ]);
    } finally { clearTimeout(timer); }
    if (out === TIMED_OUT) return bad("TIMEOUT", { ms: timeoutMs }, "", used);
    const text = String(out == null ? "" : out).trim();
    if (!text) return bad("EMPTY", { why: `no answer from ${label} — is the claude CLI installed and logged in?` }, "", used);
    const code = cliError(text);
    if (code) return bad(code, { model: used }, redact(clip(text, 500), r), used);
    const clean = stripThink(text);
    return clean ? { ok: true, text: clean, model: used } : bad("EMPTY", {}, "", used);
  }

  async function execute(ctx, json) {
    if (!ID_RE.test(ctx.provider) || !kindOf(ctx.provider, ctx.r)) {
      return bad("NOT_CONNECTED", { why: "unknown provider" }, oneLine(ctx.provider, 64));
    }
    try { fallback.cleanFallbackModel(ctx.model); }
    catch (e) { return bad("MODEL_NOT_FOUND", { why: `model id "${oneLine(ctx.model, 60)}" is not usable (${e.message})` }); }
    if (!ctx.prompt.trim()) return bad("EMPTY", { why: "nothing for the copilot to do" });
    const attempt = kindOf(ctx.provider, ctx.r) === "openai" ? httpAttempt : cliAttempt;
    let a1 = await attempt(ctx, null);
    // a reasoning model that spent the whole budget thinking: once more with twice the room
    if (!a1.ok && thoughtTooLong(a1) && ctx.maxTokens < MAX_TOKENS_CAP) {
      ctx = { ...ctx, maxTokens: Math.min(MAX_TOKENS_CAP, ctx.maxTokens * 2) };
      const again = await attempt(ctx, null);
      a1 = again.ok ? { ...again, thinkRetry: true } : again;
    }
    if (!a1.ok || !json) return a1;
    const j1 = extractJson(a1.text);
    if (j1) return { ...a1, json: j1 };
    const a2 = await attempt(ctx, a1.text);          // one retry with the "valid JSON only" nudge
    if (a2.ok) {
      const j2 = extractJson(a2.text);
      if (j2) return { ...a2, json: j2, retried: true, thinkRetry: a1.thinkRetry };
      return bad("BAD_JSON", {}, redact(clip(a2.text, 300), ctx.r), a2.model, a2.text);
    }
    return bad("BAD_JSON", {}, "retry failed: " + a2.code + (a2.detail ? " · " + a2.detail : ""), a1.model, a1.text);
  }

  // The local-model slot for a copilot call: resolves { release } once a slot is held
  // (at once when one is free), { cancelled: why } if the owner stopped the office while
  // it waited, or {} for a provider with no gate.
  function takeSlot(ctx) {
    const lane = slotLane(ctx.provider);
    if (!lane) return Promise.resolve({});
    return new Promise((resolve) => {
      const st = lane.enter({ agent: "main", task: "copilot:" + ctx.job, kind: "copilot", job: ctx.job,
        onCancel: (why) => resolve({ cancelled: String(why || "cancelled while waiting for a local-model slot") }) },
        (release) => resolve({ release }));
      if (st.queued) try { log(`[copilot] ${ctx.job} waiting for a ${ctx.label} slot (${st.running}/${st.limit} running, #${st.position} in line)`); } catch {}
    });
  }

  // run({ job, prompt, system?, json?, maxTokens?, timeoutMs?, track?:{title}, provider?, model? })
  //   → { ok, text, json|null, brain:{ provider, model, label, source }, ms, error:null|{ code, message, detail } }
  async function run(o = {}) {
    const t0 = Date.now();
    const r = getReg() || {};
    const base = brain(r);
    const explicit = typeof o.provider === "string" && o.provider.trim() ? o.provider.trim() : "";
    const provider = explicit || base.provider;
    const model = explicit ? String(o.model || "").trim()
      : typeof o.model === "string" && o.model.trim() ? o.model.trim() : String(base.model || "");
    const job = oneLine(o.job || "copilot", 40) || "copilot";
    const label = providerLabel(provider, r);
    const ctx = { provider, model, r, label, job,
      prompt: String(o.prompt == null ? "" : o.prompt),
      system: systemText(job, r, o.system, !!o.json),
      maxTokens: clampInt(o.maxTokens, 64, MAX_TOKENS_CAP, DEFAULT_MAX_TOKENS),
      timeoutMs: clampInt(o.timeoutMs, 1000, 600000, DEFAULT_TIMEOUT_MS) };
    if (isLocal(provider)) {                             // a local (often reasoning) model: room + time to think
      ctx.maxTokens = Math.max(ctx.maxTokens, LOCAL_MIN_TOKENS);
      ctx.timeoutMs = Math.max(ctx.timeoutMs, clampInt(o.localTimeoutMs, 1000, 600000, 0));
    }

    let tid = null;
    if (o.track) {
      tid = "cp" + ++taskSeq + "-" + Date.now().toString(36);
      try { broadcast({ type: "task.started", agent: "main", task: tid, title: oneLine((o.track && o.track.title) || "✨ copilot", 90) }); } catch {}
    }
    let res;
    // A gated local brain (LM Studio): wait for a slot like every other run. A 5th
    // request while four delegates hold the slots is exactly what the gate exists for.
    const slot = await takeSlot(ctx);
    try {
      if (slot.cancelled) res = bad("UPSTREAM", { why: slot.cancelled });
      else res = await execute(ctx, !!o.json);
    }
    catch (e) { res = bad("UPSTREAM", { why: "copilot failed" }, redact(oneLine(e && e.message, 300), r)); }
    finally { if (slot.release) try { slot.release(); } catch {} }

    const ms = Date.now() - t0;
    const used = res.model || model;
    const out = { ok: !!res.ok, text: res.text || "", json: res.ok && res.json ? res.json : null,
      brain: { provider, model: used, label, source: explicit ? "request" : base.source }, ms, error: null };
    if (!res.ok) {
      const detail = oneLine(res.detail, 500);
      const th = readableMessage(res.code, label, { ...res.x, model: (res.x && res.x.model) || used });
      out.error = { code: CODES.includes(res.code) ? res.code : "UPSTREAM",
        message: detail ? th + " · " + oneLine(detail, 160) : th, detail };
    }
    if (tid) {
      try { broadcast(out.ok ? { type: "task.completed", agent: "main", task: tid }
        : { type: "task.failed", agent: "main", task: tid, error: out.error.message }); } catch {}
    }
    // One line per call — never the prompt, never a key.
    try { log(`[copilot] ${job} · ${provider}/${used || "-"} · ${out.ok ? "ok" : out.error.code} · ${ms} ms${res.thinkRetry ? " · more room to think" : ""}${res.retried ? " · json retry" : ""}`); } catch {}
    return out;
  }

  // ---- settings (GET / POST /copilot/settings) ----
  function modelsFor(id, r, live) {
    const spec = specOf(id);
    const cat = ((spec && spec.models) || []).map(String).filter(Boolean);
    const pc = pcOf(r, id);
    const known = cleanModels(Array.isArray(pc.models) ? pc.models : []);
    let list;
    if (id === "claude") {
      const liveIds = (Array.isArray(pc.models) ? pc.models : []).map(String).filter(Boolean);
      list = liveIds.length ? [...cat.filter((m) => !/\d/.test(m)), ...liveIds] : cat;
    } else if (isLocal(id)) {
      const served = cleanModels((live && own(live, id) && live[id] && live[id].models) || []);
      list = [...served, ...known, ...cat].filter((m) => !NOT_CHAT_LOCAL.test(m));
    } else {
      list = [...cat, ...known];
    }
    if (pc.model && typeof pc.model === "string") list.push(pc.model);
    return [...new Set(list.filter((m) => typeof m === "string" && m && m.length <= 200))].slice(0, 300);
  }
  function connectedOf(id, r, live) {
    if (id === "claude") return true;
    const pc = pcOf(r, id);
    if (isLocal(id)) return !!(live && own(live, id) && live[id] && live[id].running) || pc.connected === true;
    if (pc.connected === false) return false;
    const kind = kindOf(id, r);
    if (kind === "anthropic") { const spec = specOf(id); return !!(pc.token && (pc.baseUrl || (spec && spec.baseUrl))); }
    if (kind === "openai") { try { const up = upstreamFor(id, r) || {}; return !!(up.chat && up.key); } catch { return false; } }
    return false;
  }
  // Claude, the two local servers (always — they need no key), every cloud/custom
  // provider that holds a credential, plus the current copilot / Director provider even
  // when it is not usable any more (connected:false) so the picker can show it.
  function providerList(r, live, extra) {
    const ids = ["claude"];
    const add = (id, stray) => { if (id && ID_RE.test(id) && !ids.includes(id) && (stray || kindOf(id, r))) ids.push(id); };
    for (const id of ["lmstudio", "ollama"]) add(id);
    for (const id of Object.keys(providers.PROVIDERS)) if (isLocal(id)) add(id);
    const pcs = r.providerConfig && typeof r.providerConfig === "object" ? r.providerConfig : {};
    const MAIN = fallback.MAIN_KEY;
    const cloud = [...new Set([...Object.keys(providers.PROVIDERS), ...Object.keys(pcs)])]
      .filter((id) => id !== "claude" && id !== "litellm" && !isLocal(id) && kindOf(id, r))
      .filter((id) => { const pc = pcOf(r, id); return pc.connected === true || !!pc.token || !!pc.baseUrl || !!(own(MAIN, id) && (r.apiKeys || {})[MAIN[id]]); })
      .sort((a, b) => (groupOf(a) === groupOf(b) ? providerLabel(a, r).localeCompare(providerLabel(b, r)) : groupOf(a) === "cloud" ? -1 : 1));
    cloud.forEach(add);
    (extra || []).forEach((id) => add(id, true));
    return ids.map((id) => ({ id, label: providerLabel(id, r), group: groupOf(id), kind: kindOf(id, r),
      connected: connectedOf(id, r, live),
      running: isLocal(id) ? (live && own(live, id) && live[id] ? !!live[id].running : null) : null,
      models: modelsFor(id, r, live) }));
  }
  async function settings() {
    const r = getReg() || {};
    const b = brain(r), d = directorOf(r), c = copilotChoice(r);
    let live = {};
    try { live = (await localStatus(r)) || {}; } catch {}
    return { provider: c.provider, model: c.model,
      effective: { provider: b.provider, model: b.model, label: b.label, source: b.source },
      director: { id: "main", name: d.name, provider: d.provider, model: d.model },
      providers: providerList(r, live, [c.provider, d.provider]) };
  }
  // Owner picks the brain: "" / "director" → follow the Director. Throws on a bad value
  // (the route answers 400). Persists reg.copilot and tells every open picker.
  function setBrain(provider, model) {
    const r = getReg();
    if (!r || typeof r !== "object") throw new Error("registry not ready");
    const p = String(provider == null ? "" : provider).trim();
    if (!p || p === "director") r.copilot = { provider: "", model: "" };
    else {
      if (p === "litellm" || !fallback.validFallbackProvider(p, r, providers.PROVIDERS) || !kindOf(p, r)) throw new Error("unknown provider");
      r.copilot = { provider: p, model: fallback.cleanFallbackModel(model) };
    }
    saveReg();
    const b = brain(r);
    const effective = { provider: b.provider, model: b.model, label: b.label, source: b.source };
    try { broadcast({ type: "copilot.settings", provider: r.copilot.provider, model: r.copilot.model, effective }, false); } catch {}
    return effective;
  }

  return { brain, run, settings, setBrain, officeContext: (reg, o) => officeContext(reg || getReg() || {}, o) };
}

let instance = null;
function init(deps) { instance = create(deps); return instance; }
function get() { return instance; }

module.exports = {
  init, get, create, CODES,
  extractJson, stripThink, classifyHttp, cliError, officeContext, providerLabel, kindOf, groupOf,
};
