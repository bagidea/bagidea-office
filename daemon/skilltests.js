// BagIdea Office — skill regression (v1.6, design J).
//
// A skill that corrects itself can correct itself wrong. This is the gate: a
// skill may carry test cases — { prompt, expect } — and a self-correction is
// accepted only if every case still passes with the CANDIDATE instructions.
// A case is judged by a real model turn (the same `ask` the office uses for
// reflection), with the candidate skill text as the only instructions.
//
//   cases(id) / setCases(id, [{ prompt, expect, note }])
//   run(id, content?)  → { ok, results: [{ prompt, expect, pass, answer }] }
//   gate(id, content)  → the same, but "no cases" counts as ok (nothing to
//                        regress against) and the run is recorded on the skill
//
// `expect` is a regular expression source (case-insensitive) — or, when it
// starts with "!", one that must NOT match. Cases live in reg.skillTests.

module.exports = function initSkillTests(ctx) {
  const reg = ctx.reg;
  const saveReg = ctx.saveReg || (() => {});
  const ask = ctx.ask;                              // (prompt, opts) => Promise<string>
  const log = ctx.log || (() => {});
  const now = ctx.now || (() => Date.now());
  const MAX_CASES = 12, TIMEOUT_MS = ctx.timeoutMs || 120000;

  const all = () => (reg.skillTests && typeof reg.skillTests === "object") ? reg.skillTests : (reg.skillTests = {});
  function cases(id) { return (all()[id] || []).map((c) => ({ ...c })); }
  function setCases(id, list) {
    if (!reg.skills || !reg.skills[id]) throw new Error("no such skill: " + id);
    const clean = (Array.isArray(list) ? list : []).map((c) => ({
      prompt: String(c.prompt || "").trim().slice(0, 1500),
      expect: String(c.expect || "").trim().slice(0, 300),
      note: String(c.note || "").trim().slice(0, 200),
    })).filter((c) => c.prompt && c.expect).slice(0, MAX_CASES);
    for (const c of clean) compile(c.expect);          // throws on a bad pattern
    if (clean.length) all()[id] = clean; else delete all()[id];
    saveReg();
    return clean;
  }
  function compile(expect) {
    const neg = expect.startsWith("!");
    const src = neg ? expect.slice(1) : expect;
    let re; try { re = new RegExp(src, "i"); } catch (e) { throw new Error("bad expect pattern: " + src); }
    return { re, neg };
  }
  function judge(expect, answer) { const { re, neg } = compile(expect); const m = re.test(String(answer || "")); return neg ? !m : m; }

  async function run(id, content, opts = {}) {
    const sk = reg.skills && reg.skills[id];
    if (!sk) throw new Error("no such skill: " + id);
    const text = String(content != null ? content : sk.content || "");
    const list = cases(id);
    const results = [];
    for (const c of list) {
      const prompt =
        `You are an AI office agent following ONE skill's instructions exactly. Do not use tools; answer in text.\n\n` +
        `<skill name="${sk.name || id}">\n${text}\n</skill>\n\n` +
        `Task: ${c.prompt}\n\nAnswer:`;
      let answer = "";
      try { answer = String(await Promise.race([ask(prompt, opts.askOpts || {}), new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), TIMEOUT_MS))]) || ""); }
      catch (e) { answer = ""; results.push({ ...c, pass: false, answer: "", error: String(e && e.message) }); continue; }
      results.push({ ...c, pass: judge(c.expect, answer), answer: answer.slice(0, 1200) });
    }
    return { id, ok: results.every((r) => r.pass), results, at: now() };
  }
  // The gate a self-correction passes through. No cases → nothing to regress
  // against → accepted (the office never blocks learning it cannot check).
  async function gate(id, candidate) {
    if (!cases(id).length) return { id, ok: true, results: [], skipped: true };
    const r = await run(id, candidate);
    const sk = reg.skills[id];
    if (sk) { sk.lastTest = { at: r.at, ok: r.ok, passed: r.results.filter((x) => x.pass).length, total: r.results.length, candidate: !r.ok }; saveReg(); }
    if (!r.ok) log(`[skills] refinement of "${id}" blocked: ${r.results.filter((x) => !x.pass).length}/${r.results.length} case(s) fail with the new text`);
    return r;
  }
  function summary() {
    const out = {};
    for (const [id, list] of Object.entries(all())) out[id] = { cases: list.length, lastTest: (reg.skills[id] || {}).lastTest || null };
    return out;
  }
  return { cases, setCases, run, gate, summary, judge, MAX_CASES };
};
