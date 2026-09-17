// 🧪 Skill Regression — the UI and the commands for the core's skill-test gate
// (daemon/skilltests.js). Cases live in the registry; the gate runs in the core
// whenever the office tries to refine one of its own skills. This plugin only
// lets people (and agents) write cases and run them by hand.
module.exports = (ctx) => {
  const st = ctx.skillTests;
  if (!st) throw new Error("this office has no skill-test support (needs v1.6+)");
  const parse = (args) => String(typeof args === "string" ? args : (args && args.text) || "").split("::").map((s) => s.trim());
  const skills = () => Object.entries(ctx.reg.skills || {}).map(([id, s]) => ({ id, name: s.name || id, auto: !!s.auto, builtin: !!s.builtin, edited: !!s.edited, revs: s.revs || 0, cases: st.cases(id).length, lastTest: s.lastTest || null }));

  return {
    onCommand(cmd, args) {
      const p = parse(args);
      if (cmd === "add") {
        const [id, prompt, expect] = p;
        const list = st.cases(id); list.push({ prompt, expect });
        return { ok: true, cases: st.setCases(id, list) };
      }
      if (cmd === "run") return st.run(p[0]).then((r) => ({ ok: r.ok, ...r, text: r.results.map((x) => `${x.pass ? "✓" : "✗"} ${x.prompt.slice(0, 60)} → ${x.expect}`).join("\n") || "(no cases)" }));
      if (cmd === "list") {
        const rows = skills().filter((s) => !p[0] || s.id === p[0]).filter((s) => p[0] || s.cases);
        return { ok: true, skills: rows, text: rows.map((s) => `${s.id}: ${s.cases} case(s)${s.lastTest ? ` · last ${s.lastTest.ok ? "passed" : "FAILED"} ${s.lastTest.passed}/${s.lastTest.total}` : ""}`).join("\n") || "(no skill has cases yet)" };
      }
      if (cmd === "clear") return { ok: true, cases: st.setCases(p[0], []) };
      return { ok: false, error: "commands: add · run · list · clear" };
    },
    routes: {
      skills: (req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ skills: skills(), cases: Object.fromEntries(skills().map((s) => [s.id, st.cases(s.id)])) })); },
      set: (req, res, { readBody }) => readBody(req, (b) => { try { const { id, cases } = JSON.parse(b); res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ ok: true, cases: st.setCases(id, cases) })); } catch (e) { res.writeHead(400); res.end(String(e.message)); } }),
      run: (req, res, { readBody }) => readBody(req, (b) => { try { const { id } = JSON.parse(b); st.run(id).then((r) => { const sk = ctx.reg.skills[id]; if (sk) { sk.lastTest = { at: r.at, ok: r.ok, passed: r.results.filter((x) => x.pass).length, total: r.results.length, candidate: false }; ctx.saveReg(); } res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(r)); }).catch((e) => { res.writeHead(400); res.end(String(e.message)); }); } catch (e) { res.writeHead(400); res.end(String(e.message)); } }),
    },
  };
};
