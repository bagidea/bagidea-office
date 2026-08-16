// A delegated result must come back to the thread the ORDER was given on.
//
// The owner gave the Director an order, he delegated it, the teammate finished,
// and the report-back landed in a DIFFERENT thread than the one the owner was
// looking at. From their seat the work simply never came back — "queda ahí
// colgado, las tareas no se resuelven". The result was never lost; it was filed
// in a thread nobody was reading. One office ended up with a thread whose every
// single entry was a report-back and not one human message.
//
// Why it happened: `makeDelegateFilter(depth, session, …)` captured `session`
// BY VALUE the moment it was built. On the owner-facing paths it is built before
// the run starts, and a fresh thread has no key yet — the UI sends `session:
// undefined`. That `undefined` then rode all the way down the chain into
// `reportToMain`, where `runClaude(… { session: undefined })` means "continue
// this agent's LATEST thread" (see the sessions comment in server.js). Minutes
// later, when the teammate finally reports, the latest thread is whatever the
// owner has opened since — so the report walks into the wrong room.
//
// The job runner already had this exact defect and already fixed it, by building
// its filter at filter time off `keyRef.key` (see dispatchJob). This module is
// that fix made explicit and shared, so every path resolves the thread LATE —
// after runClaude's `onEntry` has recorded which thread the turn actually landed
// on, and always before any text is filtered.
//
// Kept pure and dependency-free (like joborder.js) so the contract can be tested
// without booting a daemon.

/**
 * Resolve a thread reference to a session key, as late as possible.
 *
 * Accepts what the call sites actually hold:
 *   - a `keyRef` object (`{ key }`) that runClaude's onEntry fills in — read NOW,
 *     not when the ref was created. This is the case that fixes the bug.
 *   - a plain string key (an already-known thread).
 *   - a function returning either (escape hatch).
 *   - null/undefined/"" → undefined, which keeps the documented
 *     "continue the agent's latest thread" default for paths that want it.
 *
 * Never throws: a report-back going to the wrong thread is bad, but a report-back
 * that dies on the way is worse. On any error it falls back to `undefined`, which
 * is exactly the old behaviour.
 */
function resolveThread(ref) {
  try {
    if (ref == null) return undefined;
    if (typeof ref === "function") return resolveThread(ref());
    if (typeof ref === "string") return ref || undefined;
    if (typeof ref === "object" && typeof ref.key === "string") return ref.key || undefined;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * True when this reference can still change after it is handed over — i.e. the
 * thread is not pinned yet and MUST be read late. Used to document intent at the
 * call sites and asserted by the tests; the daemon resolves late either way.
 */
function isLate(ref) {
  return typeof ref === "function" ||
    (ref != null && typeof ref === "object" && "key" in ref);
}

module.exports = { resolveThread, isLate };
