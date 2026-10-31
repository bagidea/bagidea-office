"use strict";
// ---------------------------------------------------------------------------
// 🛟 Office-wide emergency fallback brain ("สมองสำรอง").
//
// When the owner opts in (reg.fallbackProvider), an agent whose own brain is
// SUSTAINEDLY overloaded / rate-limited is re-run on this brain (server.js →
// officeFallback → tryFailover). This module holds the pure decision and the
// "are the local servers up?" probe, so both are unit-testable without booting
// the daemon.
//
//   • Claude   — always usable (the machine's login/plan or ANTHROPIC_API_KEY).
//   • Local    — Ollama / LM Studio run on this machine and need NO key,
//                so they are accepted without a token (the proxy talks to their
//                default URL, or providerConfig[id].baseUrl when set).
//   • Cloud    — must carry a credential: providerConfig[id].token or .baseUrl
//                (custom endpoints), or the office main key for openai/gemini
//                (the same keys providers.resolve / proxy.upstreamFor accept).
// Never the same provider the run is already on; unset/"none" → null (off).
// ---------------------------------------------------------------------------

// Local provider ids.
const LOCAL = new Set(["ollama", "lmstudio"]);
// Default OpenAI-compatible bases (same ports as proxy.js UPSTREAM).
const LOCAL_BASE = {
  ollama: "http://127.0.0.1:11434/v1",
  lmstudio: "http://127.0.0.1:1234/v1",
};
// Cloud providers that can also run on the office MAIN key (⚙ → CONNECT → MAIN).
const MAIN_KEY = { openai: "OPENAI_API_KEY", gemini: "GEMINI_API_KEY" };

const own = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);

function isLocal(id, PROVIDERS) {
  return LOCAL.has(id) || !!(own(PROVIDERS, id) && PROVIDERS[id] && PROVIDERS[id].local);
}

// pickFallback(reg, curProvider, PROVIDERS) → { provider, model } | null
function pickFallback(reg, curProvider, PROVIDERS) {
  const r = reg || {};
  const p = typeof r.fallbackProvider === "string" ? r.fallbackProvider.trim() : "";
  if (!p || p === "none") return null;                    // feature off
  if (p === (curProvider || "claude")) return null;       // never onto the same (dead) brain
  if (p !== "claude" && !isLocal(p, PROVIDERS)) {
    const pc = own(r.providerConfig, p) ? r.providerConfig[p] || {} : {};
    const mainKey = own(MAIN_KEY, p) ? (r.apiKeys || {})[MAIN_KEY[p]] : "";
    if (!pc.token && !pc.baseUrl && !mainKey) return null; // not connected / no credential
  }
  return { provider: p, model: typeof r.fallbackModel === "string" ? r.fallbackModel : "" };
}

// Can `p` be stored as the fallback? A builtin, a local id (even one providers.js
// doesn't know yet) or a configured custom provider. Own-property checks only, so
// "constructor" / "__proto__" can never pass as a provider.
const ID_RE = /^[a-z0-9][\w.-]{0,63}$/i;
function validFallbackProvider(p, reg, PROVIDERS) {
  const id = String(p || "");
  if (!ID_RE.test(id)) return false;
  return id === "claude" || LOCAL.has(id) || own(PROVIDERS, id) || own((reg || {}).providerConfig, id);
}

// The model id rides into the agent's `claude --model <id>` command line (a
// shell:true spawn for local runs), so only model-id characters are allowed:
// letters, digits and . _ - / : @ + ~ [ ]  — e.g. "qwen3.8-27b@q4_0",
// "openai/gpt-oss-20b:free", "~anthropic/claude-opus-latest", "sonnet[1m]".
// Long enough for LM Studio's path-style ids (the old 60-char slice cut them).
const MODEL_MAX = 160;
const MODEL_RE = /^[\w.\-/:@+~[\]]*$/;
function cleanFallbackModel(m) {
  const s = String(m == null ? "" : m).trim();
  if (s.length > MODEL_MAX) throw new Error("model id too long (max " + MODEL_MAX + ")");
  if (!MODEL_RE.test(s)) throw new Error("invalid model id");
  return s;
}

// ---- GET /registry/local-status -------------------------------------------
// { ollama:{running,models,url,error}, lmstudio:{…} } — parallel
// GET <base>/models probes (1.5 s timeout each, whole request incl. body),
// cached 3 s and shared by concurrent callers.
const PROBE_MS = 1500;
const CACHE_MS = 3000;
const MAX_MODELS = 300;
let cache = null;   // { key, at, promise }

function localBase(id, reg) {
  const pcs = (reg && reg.providerConfig) || {};
  const pc = own(pcs, id) ? pcs[id] || {} : {};
  const b = typeof pc.baseUrl === "string" ? pc.baseUrl.trim().replace(/\/+$/, "") : "";
  return b || LOCAL_BASE[id];
}

// Report the probed URL without any user:pass@ it might carry.
function publicUrl(u) {
  try {
    const x = new URL(u);
    if (!x.username && !x.password) return u;
    x.username = ""; x.password = "";
    return x.href.replace(/\/+$/, "");
  } catch { return u; }
}

function modelIds(j) {
  const list = (j && (Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [])) || [];
  const out = [];
  for (const m of list) {
    const id = typeof m === "string" ? m : m && (m.id || m.name || m.model);
    if (typeof id === "string" && id && id.length <= 200 && !out.includes(id)) out.push(id);
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

async function probe(base, token, fetchImpl, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const headers = { accept: "application/json" };
    if (token) headers.authorization = "Bearer " + token;
    const r = await fetchImpl(base + "/models", { headers, signal: ctrl.signal });
    if (!r.ok) {
      try { if (r.body && r.body.cancel) await r.body.cancel(); } catch {}
      return { running: false, models: [], error: "HTTP " + r.status };
    }
    let models = [];
    try { models = modelIds(await r.json()); } catch {}
    return { running: true, models, error: null };
  } catch (e) {
    const code = ctrl.signal.aborted ? "timeout"
      : (e && e.cause && e.cause.code) || (e && e.code) || String((e && e.message) || e);
    return { running: false, models: [], error: String(code).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

function localStatus(reg, opts = {}) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const ms = opts.timeoutMs || PROBE_MS;
  const ids = [...LOCAL];
  const bases = ids.map((id) => localBase(id, reg));
  const key = bases.join("|");
  const now = Date.now();
  if (!opts.fresh && cache && cache.key === key && (cache.at === 0 || now - cache.at < CACHE_MS)) return cache.promise;
  const pcs = (reg && reg.providerConfig) || {};
  const promise = Promise.all(ids.map((id, i) => {
    const pc = own(pcs, id) ? pcs[id] || {} : {};
    return probe(bases[i], pc.token, fetchImpl, ms).then((s) => [id, { ...s, url: publicUrl(bases[i]) }]);
  })).then((pairs) => Object.fromEntries(pairs));
  const entry = { key, at: 0, promise };   // at 0 = in flight (shared by concurrent callers)
  cache = entry;
  promise.then(() => { if (cache === entry) entry.at = Date.now(); });   // 3 s from the ANSWER
  return promise;
}

function resetLocalStatusCache() { cache = null; }

module.exports = {
  LOCAL, LOCAL_BASE, MAIN_KEY, MODEL_MAX, PROBE_MS, CACHE_MS,
  isLocal, pickFallback, validFallbackProvider, cleanFallbackModel,
  localBase, localStatus, resetLocalStatusCache,
};
