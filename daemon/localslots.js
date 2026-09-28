"use strict";
// Local-model slot gate — at most N concurrent `claude` spawns per LOCAL provider.
//
// Why: on 25 Sep 2026 eight delegates on the LM Studio agent (unified KV cache,
// 262144 ctx, 8 server slots) each fired a ~60k-token first prompt at the same
// moment. llama.cpp could not fit eight prompts of that size into the shared KV
// cache and logged 36× "failed to decode, ret = 1"; every delegate died. The
// daemon throttled only SCHEDULED jobs (dispatchJob / reg.maxJobs) — a DELEGATE
// fan-out, a SUB: ghost split or plain chat turns had no cap at all.
//
// This module is the pure, daemon-free half of the fix: a FIFO gate that hands
// out slots, queues what doesn't fit, and starts queued work the instant a slot
// frees. server.js owns the visible side (the "waiting for a local-model slot"
// line in the session log) and calls release() from the one funnel every run
// end passes through.
//
// Limit resolution (read LIVE on every enter/release, so an edit applies without
// a daemon restart):
//   1. registry  reg.providerConfig[provider].maxConcurrent
//   2. env       LMSTUDIO_MAX_CONCURRENT
//   3. default   4
// A limit of 0 means "no cap" (opt out); anything unparsable falls to the default.

const DEFAULT_LIMIT = 4;

// Providers that get a gate, and the env var that tunes each. Only LM Studio
// today — the failure was measured there. Adding a row is the whole change.
const GATED = {
  lmstudio: { env: "LMSTUDIO_MAX_CONCURRENT", label: "LM Studio" },
};

// The exact phrase the session log carries while a run waits. Pinned by tests —
// the owner (and the field-issue triage) greps for it.
const WAIT_PHRASE = "waiting for a local-model slot";

function parseLimit(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/** Effective cap for a provider: registry → env → default. 0 = uncapped. */
function limitFor(provider, reg, env) {
  const spec = GATED[provider];
  if (!spec) return 0;
  const pc = ((reg && reg.providerConfig) || {})[provider] || {};
  const fromReg = parseLimit(pc.maxConcurrent);
  if (fromReg !== null) return fromReg;
  const fromEnv = parseLimit((env || process.env)[spec.env]);
  if (fromEnv !== null) return fromEnv;
  return DEFAULT_LIMIT;
}

const isGated = (provider) => !!GATED[provider];

/** Human line for the log while queued. */
function waitLine(provider, st) {
  const label = (GATED[provider] && GATED[provider].label) || provider;
  const ahead = st.position > 1 ? `${st.position - 1} ahead in the queue` : "next in line";
  return `⏳ ${WAIT_PHRASE} — ${label} is already serving ${st.running}/${st.limit} runs; ${ahead}. ` +
    `This run starts by itself as soon as a slot frees.`;
}

/** Human line for the log when a queued run finally starts. */
function startLine(provider, waitedMs) {
  const label = (GATED[provider] && GATED[provider].label) || provider;
  const s = Math.max(0, Math.round((waitedMs || 0) / 1000));
  return `▶ local-model slot free — starting on ${label} now (waited ${s}s).`;
}

/**
 * One gate per provider.
 *   enter(meta, start) → { queued:false, running, limit }  start(release) was called
 *                      → { queued:true, position, running, limit }  parked in FIFO
 *   `release` is idempotent; the next queued job starts inside the same tick.
 *   cancel(pred)       → removes queued jobs whose meta matches; returns them
 *                        (their start() is never called; callers finish them).
 *   state()            → { running, queued, limit }
 */
class SlotGate {
  constructor(provider, limitFn) {
    this.provider = provider;
    this._limit = typeof limitFn === "function" ? limitFn : () => DEFAULT_LIMIT;
    this.running = 0;
    this.queue = [];
  }
  limit() { return this._limit(); }
  _free() { const l = this.limit(); return l === 0 || this.running < l; }
  enter(meta, start) {
    if (!this._free()) {
      this.queue.push({ meta: meta || {}, start, at: Date.now() });
      return { queued: true, position: this.queue.length, running: this.running, limit: this.limit() };
    }
    this._launch({ meta: meta || {}, start, at: Date.now() });
    return { queued: false, running: this.running, limit: this.limit() };
  }
  _launch(job) {
    this.running++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.running = Math.max(0, this.running - 1);
      this._drain();
    };
    try { job.start(release, job); }
    catch (e) {
      release();   // a start that throws must not eat the slot
      throw e;
    }
  }
  _drain() {
    while (this.queue.length && this._free()) {
      const job = this.queue.shift();
      try { this._launch(job); } catch (e) { console.error("[localslots] queued start failed:", e && e.message); }
    }
  }
  cancel(pred) {
    const gone = [], keep = [];
    for (const j of this.queue) ((!pred || pred(j.meta, j)) ? gone : keep).push(j);
    this.queue = keep;
    return gone;
  }
  state() { return { running: this.running, queued: this.queue.length, limit: this.limit() }; }
}

/**
 * Registry of gates. `getReg` returns the live registry object (so the limit
 * follows edits), `env` is injectable for tests.
 */
function createSlots({ getReg = () => ({}), env } = {}) {
  const gates = {};
  const laneFor = (provider) => {
    if (!isGated(provider)) return null;
    if (!gates[provider]) gates[provider] = new SlotGate(provider, () => limitFor(provider, getReg(), env));
    return gates[provider];
  };
  const snapshot = () => {
    const out = {};
    for (const p of Object.keys(gates)) out[p] = gates[p].state();
    return out;
  };
  return { laneFor, snapshot, isGated, limitFor: (p) => limitFor(p, getReg(), env) };
}

module.exports = { createSlots, SlotGate, limitFor, isGated, waitLine, startLine,
  WAIT_PHRASE, DEFAULT_LIMIT, GATED };
