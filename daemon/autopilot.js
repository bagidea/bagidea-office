// 🤖 AUTO mode — the pure text bits, kept out of server.js so they can be tested.
//
// A teammate is a one-shot `claude -p` process: nothing can nudge it mid-run, so
// the only way to keep work moving is to START THE NEXT TURN. For that the daemon
// has to know whether the turn that just ended left work behind — hence a single
// machine-readable STATUS line at the end of every owner-facing message.
//
//   STATUS: DONE      — finished and verified, nothing pending
//   STATUS: CONTINUE  — more to do (the office opens the next turn immediately)
//   STATUS: BLOCKED   — genuinely needs the owner (missing access, irreversible act)

const STATUS_RE = /(^|\n)[ \t]*STATUS:[ \t]*(DONE|CONTINUE|BLOCKED)\b[ \t]*[—:-]?[ \t]*([^\n]*)/i;

/** The status a turn reported, or null when it didn't follow the protocol. */
function readStatus(text) {
  const m = STATUS_RE.exec(String(text || ""));
  return m ? { kind: m[2].toUpperCase(), note: (m[3] || "").trim() } : null;
}

/** The STATUS line is machinery, not conversation — never show it to the owner. */
function stripStatus(text) {
  return String(text || "")
    .replace(/(^|\n)[ \t]*STATUS:[ \t]*(DONE|CONTINUE|BLOCKED)\b[^\n]*/gi, "$1")
    .trim();
}

/**
 * Protocol ignored, but the turn clearly ended by asking the owner something —
 * the exact stall AUTO exists to remove. Deliberately narrow: it looks at the
 * TAIL of the message, so a question asked in passing halfway through a finished
 * report doesn't restart a job that is already done.
 */
function looksLikeAsking(text) {
  const tail = String(text || "").trim().split("\n").filter((l) => l.trim()).slice(-3).join(" ");
  if (!tail) return false;
  return /[?？]\s*$/.test(tail) ||
    /(ไหมครับ|ไหมคะ|หรือเปล่า|หรือไม่|เอาแบบไหน|เลือกแบบไหน|จะให้ผมทำ|ต้องการให้ผม|รอคำสั่ง|บอกมาได้เลย|which (one|approach)|shall i|should i|let me know)/i
      .test(tail);
}

/** What AUTO should do with a finished turn: "CONTINUE" | "DONE" | "BLOCKED". */
function verdict(text) {
  const st = readStatus(text);
  if (st) return st.kind;
  return looksLikeAsking(text) ? "CONTINUE" : "DONE";
}

module.exports = { readStatus, stripStatus, looksLikeAsking, verdict, STATUS_RE };
