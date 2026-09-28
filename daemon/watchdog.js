"use strict";
// RunWatchdog — reaps stuck `runClaude` runs (issue #15, Bug 1).
//
// The Claude CLI retries a hung upstream every ~60s. Without a watchdog, a
// single bad turn leaves a task pinned in the "started" state until the CLI
// eventually gives up on its own (observed: 14 minutes for task t1). This
// class enforces two independent limits:
//
//   - totalMs : hard wall-clock cap on the whole run (e.g. 30 min)
//   - idleMs  : no `task.progress` for this long ⇒ the run is making no
//               forward progress and should be killed (e.g. 5 min)
//
// Whichever fires first calls `onKill(reason)` once. `touch()` records
// progress and resets the idle timer. `clear()` tears both timers down and
// makes the instance inert — safe to call from an `onDone` callback.

class RunWatchdog {
  constructor({ totalMs, idleMs, onKill }) {
    this.totalMs = totalMs;
    this.idleMs = idleMs;
    this.onKill = onKill || (() => {});
    this._totalTimer = null;
    this._idleTimer = null;
    this._fired = false;
    this._startTs = 0;
  }

  start() {
    if (this._totalTimer || this._idleTimer) return;
    this._startTs = Date.now();
    if (this.totalMs > 0)
      this._totalTimer = setTimeout(() => this._fire(`total ${this.totalMs}ms cap exceeded`), this.totalMs);
    if (this.idleMs > 0)
      this._idleTimer = setTimeout(() => this._fire(`idle ${this.idleMs}ms — no progress`), this.idleMs);
  }

  touch() {
    if (this._fired) return;
    if (this.idleMs > 0 && this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = setTimeout(() => this._fire(`idle ${this.idleMs}ms — no progress`), this.idleMs);
    }
  }

  _fire(reason) {
    if (this._fired) return;
    this._fired = true;
    this.clear();
    try { this.onKill(reason); } catch (e) { /* never let a kill callback break teardown */ }
  }

  clear() {
    if (this._totalTimer) { clearTimeout(this._totalTimer); this._totalTimer = null; }
    if (this._idleTimer) { clearTimeout(this._idleTimer); this._idleTimer = null; }
  }
}

// Idle window for a run whose brain sits behind the in-process proxy. The proxy
// calls upstream with stream=false, so the CLI emits nothing while one request is
// in flight; the idle window must outlast the proxy's own upstream cap or a
// legitimately slow local turn is reaped first. Returns max(base, cap + margin)
// for a positive finite cap, else base. Pure; bad inputs fall back safely.
function runIdleMsFor({ baseIdleMs, proxyTimeoutMs, marginMs = 60000 } = {}) {
  const pos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const base = pos(baseIdleMs);
  const cap = pos(proxyTimeoutMs);
  if (!cap) return base;
  const margin = Number.isFinite(Number(marginMs)) && Number(marginMs) >= 0 ? Number(marginMs) : 60000;
  return Math.max(base, cap + margin);
}

// Total wall-clock cap for a run. A LOCAL brain behind the proxy answers one
// request in up to its proxy cap, so a long local run needs more than the remote
// 30-min cap (SHINO D1, 2026-09-27: 60 min for local runs only). Returns
// max(base, localTotal) for a local run with a positive finite localTotal, else
// base. Pure; bad inputs fall back to base.
function runTotalMsFor({ baseTotalMs, local, localTotalMs } = {}) {
  const pos = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };
  const base = pos(baseTotalMs);
  const loc = pos(localTotalMs);
  if (!local || !loc) return base;
  return Math.max(base, loc);
}

module.exports = { RunWatchdog, runIdleMsFor, runTotalMsFor };
