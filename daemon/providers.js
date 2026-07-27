"use strict";
// ---------------------------------------------------------------------------
// Per-agent model/provider routing — the office's "swappable brain".
//
// The agent runtime is ALWAYS the Claude Code CLI (`claude -p`): it owns the
// tools, the agentic loop, skills, sessions. Only the *model behind it* changes.
// `claude` is just a client — point ANTHROPIC_BASE_URL at another endpoint and it
// talks to that backend instead, authenticated with ANTHROPIC_AUTH_TOKEN. So
// switching an agent to GLM/Qwen/DeepSeek/MiniMax is purely env + --model.
//
//   • Anthropic-format providers (direct: true)  → ANTHROPIC_BASE_URL straight at
//     their Anthropic-compatible endpoint. No proxy.
//   • OpenAI-format providers   (needsProxy: true) → ANTHROPIC_BASE_URL at a local
//     LiteLLM gateway that translates Anthropic <-> OpenAI (wired in P3).
//
// FAIL-OPEN: an unconfigured, unknown, or "claude" provider returns empty
// overrides, so the spawn is byte-identical to today's plain-Claude behavior.
// (A *configured* provider with a bad token will fail that run — same as a bad
// Claude key today; we do not silently re-route to Claude.)
// ---------------------------------------------------------------------------

// Catalog. `baseUrl` filled only where the endpoint is confirmed; the rest are
// supplied via reg.providerConfig[id].baseUrl (verified per-provider in P2).
// `models` is a hint list for the settings UI — any string is accepted.
const PROVIDERS = {
  claude: {
    // Anthropic DOES list models — but not with a per-provider key like everyone
    // else: the office runs on the machine's own Claude auth. server.js
    // (fetchClaudeModels) pulls this URL with ANTHROPIC_API_KEY, or failing that
    // the Claude Code CLI's local subscription token. The list below is only the
    // offline fallback for when neither is available.
    label: "Claude · Anthropic", format: "anthropic", direct: true, baseUrl: null,
    modelsUrl: "https://api.anthropic.com/v1/models?limit=100",
    models: ["", "opus", "sonnet", "haiku",
             "claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-opus-4-8",
             "claude-sonnet-4-6", "claude-haiku-4-5"],
  },
  glm: {
    label: "GLM · Z.AI", format: "anthropic", direct: true,
    baseUrl: "https://api.z.ai/api/anthropic",          // confirmed (Z.AI docs)
    modelsUrl: "https://api.z.ai/api/paas/v4/models",   // OpenAI-compatible model list
    // GLM-5.2's full 1M context is unlocked ONLY by the "glm-5.2[1m]" id — plain
    // "glm-5.2" serves ~200k. List the [1m] variant first so the picker favors it.
    models: ["glm-5.2[1m]", "glm-5.2", "glm-4.6", "glm-4.5"],  // hint only — live list fetched on Connect
  },
  deepseek: {
    label: "DeepSeek", format: "anthropic", direct: true,
    baseUrl: "https://api.deepseek.com/anthropic",        // confirmed (DeepSeek docs)
    modelsUrl: "https://api.deepseek.com/models",
    models: ["deepseek-v4-pro", "deepseek-v4-flash"],     // chat/reasoner deprecated 2026-07-24
  },
  qwen: {
    label: "Qwen · Alibaba", format: "anthropic", direct: true,
    // confirmed (Alibaba Model Studio docs). International endpoint; mainland-China
    // is https://dashscope.aliyuncs.com/apps/anthropic — set reg.providerConfig.qwen.baseUrl.
    baseUrl: "https://dashscope-intl.aliyuncs.com/apps/anthropic",
    modelsUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models",
    models: ["qwen3-coder-plus", "qwen3-coder-next", "qwen3-coder-flash"],
  },
  minimax: {
    label: "MiniMax", format: "anthropic", direct: true,
    // confirmed (MiniMax docs). International endpoint; mainland-China is
    // https://api.minimaxi.com/anthropic (extra "i") — set reg.providerConfig.minimax.baseUrl.
    baseUrl: "https://api.minimax.io/anthropic",
    // Best-effort live list from MiniMax's OpenAI-compatible endpoint; if it 404s
    // the fetch is caught and we fall back to the static hint (never blocks Connect).
    modelsUrl: "https://api.minimax.io/v1/models",
    models: ["MiniMax-M3"],
  },
  moonshot: {
    label: "Kimi · Moonshot", format: "anthropic", direct: true,
    // confirmed (Moonshot docs). International endpoint; mainland-China is
    // https://api.moonshot.cn/anthropic — set reg.providerConfig.moonshot.baseUrl.
    baseUrl: "https://api.moonshot.ai/anthropic",
    modelsUrl: "https://api.moonshot.ai/v1/models",
    models: ["kimi-k2.6", "kimi-k2.5", "kimi-k2", "kimi-latest"],  // hint only — live list fetched on Connect
  },
  kimicode: {
    // Kimi Code — the coding subscription (kimi.com/code). DISTINCT from Moonshot's
    // general API above: separate "sk-kimi-…" keys, its own Anthropic-compatible
    // endpoint, and a single model id. Confirmed live (200) against the global host;
    // mainland-China users can override baseUrl in Connect.
    label: "Kimi Code · coding plan", format: "anthropic", direct: true,
    baseUrl: "https://api.kimi.com/coding",     // → /v1/messages (Anthropic-compatible)
    models: ["kimi-for-coding"],                // the only model this plan serves
  },
  openai: {
    label: "OpenAI", format: "openai", needsProxy: true, baseUrl: null,
    models: ["gpt-4.1", "gpt-4o", "gpt-4o-mini"],   // gpt-4.1 = 1M flagship, listed first
  },
  gemini: {
    label: "Gemini", format: "openai", needsProxy: true, baseUrl: null,
    models: ["gemini-2.5-pro", "gemini-2.5-flash"],
  },
  openrouter: {
    label: "OpenRouter", format: "openai", needsProxy: true, baseUrl: null,
    models: ["openai/gpt-4o", "anthropic/claude-sonnet-4-6", "deepseek/deepseek-chat"],
  },
  nvidia: {
    label: "NVIDIA build", format: "openai", needsProxy: true, baseUrl: null,
    models: ["meta/llama-3.3-70b-instruct", "deepseek-ai/deepseek-v3"],
  },
  groq: {
    label: "Groq", format: "openai", needsProxy: true, baseUrl: null,
    models: ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"],
  },
  cerebras: {
    label: "Cerebras", format: "openai", needsProxy: true, baseUrl: null,
    models: ["llama-3.3-70b", "llama-3.1-8b"],
  },
  xai: {
    label: "xAI · Grok", format: "openai", needsProxy: true, baseUrl: null,
    models: ["grok-4", "grok-3", "grok-3-mini"],
  },
  mistral: {
    label: "Mistral", format: "openai", needsProxy: true, baseUrl: null,
    models: ["mistral-large-latest", "codestral-latest"],
  },
  together: {
    label: "Together AI", format: "openai", needsProxy: true, baseUrl: null,
    models: ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  },
  fireworks: {
    label: "Fireworks AI", format: "openai", needsProxy: true, baseUrl: null,
    models: ["accounts/fireworks/models/llama-v3p3-70b-instruct"],
  },
  // Local OpenAI-compatible servers — no key needed (local: true). Default ports.
  ollama: {
    label: "Ollama · local", format: "openai", needsProxy: true, local: true, baseUrl: null,
    models: ["llama3.1", "qwen2.5-coder", "deepseek-r1"],
  },
  lmstudio: {
    label: "LM Studio · local", format: "openai", needsProxy: true, local: true, baseUrl: null,
    models: [],
  },
};

const DEFAULT_LITELLM = "http://127.0.0.1:4000";

// resolve(provider, model, reg) -> { ok, env, modelArgs, reason }
//   env       : object spread into the child's env (ANTHROPIC_BASE_URL/_AUTH_TOKEN)
//   modelArgs : [] or ["--model", "<id>"] pushed into the claude argv
//   reg.providerConfig = {
//     glm:      { token, baseUrl?, model? },
//     deepseek: { token, baseUrl?, model? },
//     litellm:  { baseUrl?, token? },          // for openai/gemini
//     ...
//   }
function resolve(provider, model, reg = {}, opts = {}) {
  const out = { ok: true, env: {}, modelArgs: [], reason: "claude-default" };
  const pConf = (reg && reg.providerConfig) || {};

  // Default brain: plain Claude. Optional explicit model only.
  if (!provider || provider === "claude") {
    if (model) out.modelArgs = ["--model", String(model)];
    return out;
  }

  const spec = PROVIDERS[provider];
  const pc = pConf[provider] || {};
  // "anthropic" (claude talks straight to the endpoint) or "openai" (via the
  // built-in proxy). Built-ins read it from the catalog; CUSTOM providers store
  // their kind/baseUrl/token in providerConfig[id].
  const kind = spec ? spec.format : pc.kind;
  if (!kind) return { ok: false, env: {}, modelArgs: [], reason: "unknown-provider" };

  let baseUrl, token;
  if (kind === "openai") {
    // Needs translation. openai/gemini may use an explicit LiteLLM gateway; everyone
    // else (openrouter/nvidia/custom) uses the daemon's built-in proxy, which resolves
    // the real upstream + key from providerConfig (proxy.js → upstreamFor).
    const builtinPair = provider === "openai" || provider === "gemini";
    const lc = pConf.litellm;
    const liteUrl = builtinPair && ((lc && lc.baseUrl) || reg.litellmUrl);
    if (liteUrl) {
      baseUrl = liteUrl;
      token = (lc && lc.token) || pc.token || "litellm";
    } else if (opts.proxyBase) {
      const mainKey = provider === "openai" ? (reg.apiKeys || {}).OPENAI_API_KEY
                    : provider === "gemini" ? (reg.apiKeys || {}).GEMINI_API_KEY : null;
      if (!pc.token && !mainKey && !(spec && spec.local)) {
        return { ok: false, env: {}, modelArgs: [], reason: "key-not-set" };
      }
      baseUrl = `${opts.proxyBase}/proxy/${provider}`;
      token = "office";   // the proxy injects the real key; this value is ignored
    } else {
      return { ok: false, env: {}, modelArgs: [], reason: "no-proxy-available" };
    }
  } else {
    // anthropic-kind: direct.
    baseUrl = pc.baseUrl || (spec && spec.baseUrl);
    token = pc.token;
    if (!baseUrl || !token) {
      return { ok: false, env: {}, modelArgs: [], reason: "not-configured" };
    }
  }

  out.env = { ANTHROPIC_BASE_URL: baseUrl, ANTHROPIC_AUTH_TOKEN: token };
  let m = pc.model || model;
  if (!m && kind === "openai") {
    m = provider === "openai" ? "gpt-4o-mini" : provider === "gemini" ? "gemini-2.5-flash" : "";
  }
  if (m) out.modelArgs = ["--model", String(m)];
  out.reason = provider;
  return out;
}

module.exports = { PROVIDERS, DEFAULT_LITELLM, resolve };
