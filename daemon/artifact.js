// The artifact pattern: a teammate's result goes to DISK; the Director gets a
// short head plus a pointer, and reads the rest only if it actually needs to.
//
// Anthropic's own multi-agent write-up names this pattern:
//
//   "Subagents write their findings to a shared filesystem and return a
//    lightweight reference — the artifact pattern — so the lead agent does not
//    re-read every detail."
//   https://www.anthropic.com/engineering/multi-agent-research-system
//
// Why it matters here, measured rather than assumed. On 2026-08-16 the office
// spent ~US$195 in a day, and the split by billing tier was:
//
//   lectura de cache   225.8M tokens   ~US$113   58%
//   escritura de cache   5.1M tokens   ~US$32    16%
//   salida               1.15M tokens  ~US$29    15%
//   entrada fresca       0.05M tokens  ~US$0.25   0.1%
//
// Fresh input is a rounding error. Almost the whole bill is the cost of
// CARRYING THE CONVERSATION FORWARD — every turn re-sends everything already in
// the thread. That is why the compression tools evaluated on the same day
// (RTK and friends) measured a 0.2% saving: they compress fresh input, which is
// 0.1% of the spend. They were aimed at the wrong tier.
//
// `reportToMain` used to paste up to 6000 characters of each teammate's report
// straight into the Director's thread. That blob is not read once — it is
// re-sent as cache on every subsequent turn of that thread, for the rest of the
// thread's life. Ten reports in a day is ~60k characters the Director re-reads
// forever.
//
// So the report goes to a file, and the thread carries a head plus the path.
// The Director has Read/Glob/Grep; if the head is not enough, it opens the file
// — one bounded cost at the moment of need, instead of an unbounded one on
// every turn thereafter.
//
// Kept pure and dependency-free (like joborder.js and reportthread.js) so the
// contract can be tested without booting a daemon or touching a filesystem.

// How much of the report rides in the thread. Enough to decide "is this done,
// did they ask me something, do I need to delegate again?" without opening the
// file — that is the Director's actual job at this point. Everything past it is
// detail the Director usually never needs, and used to pay for on every turn.
const HEAD_CHARS = 1200;

/**
 * Split a teammate's result into the part that rides in the thread and the part
 * that goes to disk. `full` is ALWAYS the complete text — the file is the
 * record of what was actually said, never a truncated copy.
 */
function splitReport(text, headChars = HEAD_CHARS) {
  const full = String(text == null ? "" : text);
  const n = Number.isFinite(headChars) && headChars > 0 ? Math.floor(headChars) : HEAD_CHARS;
  if (full.length <= n) return { head: full, full, truncated: false };
  // Prefer a paragraph or line boundary in the last quarter of the budget, so
  // the head ends on a thought instead of mid-word. Falls back to a hard cut.
  const window = full.slice(0, n);
  const floor = Math.floor(n * 0.75);
  const cut = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
  const at = cut >= floor ? cut : n;
  return { head: full.slice(0, at).trimEnd(), full, truncated: true };
}

/** Filesystem-safe, sortable name for one report. `stamp` is passed in (testable). */
function reportFileName(fromId, stamp) {
  const id = String(fromId || "agente").replace(/[^\w.-]+/g, "_").slice(0, 40) || "agente";
  const t = String(stamp == null ? "" : stamp).replace(/[^\w-]+/g, "");
  return `${t}-${id}.md`;
}

/** The file's own contents: the full result plus enough header to stand alone. */
function reportFileBody({ name, fromId, ok, task, when, text }) {
  const head = [
    `# Informe de ${name || fromId}`,
    "",
    `- **Agente:** \`${fromId}\``,
    `- **Resultado:** ${ok ? "terminado" : "**LA TAREA FALLÓ**"}`,
    when ? `- **Fecha:** ${when}` : null,
    task ? `- **Tarea:** ${String(task).replace(/\s+/g, " ").slice(0, 300)}` : null,
    "",
    "---",
    "",
  ].filter((l) => l !== null).join("\n");
  return head + String(text == null ? "" : text) + "\n";
}

/**
 * The prompt the Director actually receives. Carries the head inline and the
 * file path as a pointer — the lightweight reference of the artifact pattern.
 *
 * `file` is optional: if writing to disk failed, this degrades to the old
 * behaviour (full text inline) rather than losing the report. A report that
 * costs too much is bad; a report that vanishes is worse.
 */
function buildReportPrompt({ name, fromId, ok, depth, head, truncated, full, file }) {
  const failed = ok ? "" : " — THE TASK FAILED";
  const body = file
    ? `"""${head}"""\n\n` +
      (truncated
        ? `(Recorte. El informe completo está en \`${file}\` — abrilo con Read SOLO si ` +
          `necesitás el detalle para decidir. Si con esto alcanza, no lo abras.)\n\n`
        : `(Informe completo, guardado además en \`${file}\`.)\n\n`)
    : `"""${String(full == null ? "" : full).slice(0, 6000)}"""\n\n`;

  const next = depth < 2
    ? `If they asked you a question or something is missing, answer / follow ` +
      `up with a line: DELEGATE: ${fromId} :: <your answer or next instruction> ` +
      `(exact format — it resumes their session with full context). ` +
      `If the work is complete, write the final summary for the owner (CEO): ` +
      `clear, concrete, in the language of the original order.`
    : `Write the final summary for the owner (CEO) now — clear, concrete, in ` +
      `the language of the original order. Do not delegate further.`;

  return `Report back from your team member ${name} (${fromId})${failed}:\n` + body + next;
}

module.exports = {
  HEAD_CHARS, splitReport, reportFileName, reportFileBody, buildReportPrompt,
};
