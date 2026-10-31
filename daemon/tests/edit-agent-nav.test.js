// Edit Agent ‹ › navigation + the guarded modal close.
//
// The overlay is one big classic <script>, so these are static checks on
// overlay.html: the guard is wired everywhere it must be, and the pure pieces
// (roster order, dirty key, text-field test, draft storage, hdr) are cut out
// of the page and run in a VM. The behaviour itself is exercised in jsdom by
// the dev UI harness.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const HTML = fs.readFileSync(path.join(__dirname, "..", "overlay.html"), "utf8").replace(/\r\n/g, "\n");   // CRLF on a Windows checkout
const css = HTML.slice(HTML.indexOf("<style>"), HTML.indexOf("</style>"));

// Source of a top-level `function name(…) { … }` (2-space indented in the page),
// brace-matched. Only used on helpers without braces inside strings/regexes.
function fnSource(name) {
  const m = new RegExp("\\n  (?:async )?function " + name + "\\(").exec(HTML);
  assert.ok(m, name + "() is missing from overlay.html");
  let depth = 0;   // the body starts at the first "{" after the parameter list
  for (let j = HTML.indexOf(") {", m.index) + 2; j < HTML.length; j++) {
    if (HTML[j] === "{") depth++;
    else if (HTML[j] === "}" && --depth === 0) return HTML.slice(m.index + 1, j + 1);
  }
  throw new Error("unbalanced braces in " + name);
}
const run = (src, ctx = {}) => vm.runInNewContext(src, ctx);

test("the guard / navigation functions exist at top level", () => {
  for (const f of ["requestCloseModal", "setModalForm", "modalForm", "nudgeModalForm", "modalToast",
    "flagFormField", "saveAgentForm", "agentListOrder", "agentNavOrder", "navAgent",
    "captureEditorState", "restoreEditorState", "readHireDraft", "writeHireDraft", "dropHireDraft",
    "editorFields", "editorFieldKey", "editorAnchor", "alignEditorAnchor", "settleEditorView",
    "showAgentNav", "hideAgentNav", "paintAgentNav", "agentNavNote", "setAgentNavBusy"])
    fnSource(f);
  assert.match(HTML, /\n {2}async function saveAgentForm\(\{ close = true \} = \{\}\) \{/, "saveAgentForm({ close })");
  assert.match(HTML, /\n {2}function openEditor\(id, nav\) \{/, "openEditor(id, nav) — existing callers pass only id");
});

test("a backdrop click needs the press on the backdrop too (drag-select never closes)", () => {
  assert.match(HTML, /for \(const type of \["pointerdown", "mousedown"\]\)\s*modal\.addEventListener\(type, \(e\) => \{ _pressOnBackdrop = e\.target === modal; \}, true\);/,
    "press is tracked on #modal in the capture phase");
  assert.match(HTML, /const fromBackdrop = e\.target === modal && _pressOnBackdrop;/, "click requires the press on the backdrop");
  assert.doesNotMatch(HTML, /modal\.addEventListener\("click", \(e\) => \{ if \(e\.target === modal\) closeModal\(\); \}\);/,
    "the old click-target-only check is gone");
});

test("form panels nudge instead of closing; the flag dies with the panel", () => {
  const click = HTML.slice(HTML.indexOf("const fromBackdrop"), HTML.indexOf("const fromBackdrop") + 300);
  assert.match(click, /if \(modalForm\(\)\) nudgeModalForm\(\);[^\n]*\n\s*else closeModal\(\);/);
  assert.match(fnSource("closeModal"), /setModalForm\(null\)/, "closeModal clears the form flag");
  assert.match(fnSource("setModalForm"), /modal\.dataset\.form/);
  assert.match(fnSource("modalForm"), /isConnected/, "the flag is tied to the panel's header node");
  assert.match(HTML, /new MutationObserver\(\(\) => modalForm\(\)\)\.observe\(modalCard, \{ childList: true \}\);/,
    "another panel render clears it");
  assert.match(fnSource("openEditor"), /setModalForm\(\{ kind: "agent"/, "Edit/Hire Agent is a form");
  const sk = fnSource("openSkillEditor");
  assert.ok(sk.indexOf('setModalForm({ kind: "skill"') > sk.indexOf("if (locked) return;"),
    "only an editable skill is a form (the built-in view stays read-only)");
  assert.match(fnSource("nudgeModalForm"), /classList\.add\("shake"\)[\s\S]*tr\("กด ✕ หรือ ยกเลิก เพื่อปิด"\)/);
});

test("the shake has keyframes and respects prefers-reduced-motion", () => {
  assert.match(css, /@keyframes modalShake \{/);
  assert.match(css, /#modal\.open #modalCard\.shake \{ animation: popIn [^;]*, modalShake /,
    "popIn stays first so it is not replayed");
  const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(rm.length < css.length, "a reduced-motion block exists");
  const block = rm.slice(0, rm.indexOf("\n  }"));
  assert.match(block, /#modalCard\.shake \{ animation: popIn[^;]*both;/);
  assert.doesNotMatch(block, /modalShake/, "no shake under reduced motion");
});

test("hdr()'s ✕, Cancel and Esc route through requestCloseModal", () => {
  const hdr = run(fnSource("hdr") + ";hdr");
  const h = hdr("✏ EDIT AGENT");
  assert.match(h, /<div class="winbtn x" onclick="requestCloseModal\(\)">✕<\/div>/);
  assert.doesNotMatch(h, /classList\.remove/, "the ✕ no longer just hides the modal");
  assert.match(fnSource("openEditor"), /#eCancel"\)\.onclick = \(\) => requestCloseModal\(\(\) => openSettings\("agents"\)\)/);
  assert.match(fnSource("openSkillEditor"), /#sCancel"\)\.onclick = \(\) => requestCloseModal\(\(\) => openSettings\("skills"\)\)/);
  const esc = HTML.slice(HTML.indexOf('if (e.key !== "Escape"'), HTML.indexOf('if (e.key !== "Escape"') + 700);
  assert.match(esc, /e\.isComposing/, "IME composition keeps its Esc");
  assert.match(esc, /!modalForm\(\)/, "Esc only closes form panels (read-only panels never had it)");
  assert.match(esc, /overlayAboveModal\(\)/, "popups above the modal own Esc");
  assert.match(esc, /requestCloseModal\(\);/);
});

test("requestCloseModal: clean → closes at once, dirty → the in-panel bar", () => {
  const src = fnSource("requestCloseModal");
  const calls = [];
  const ctx = {
    closeModal: () => calls.push("close"),
    showDirtyBar: () => calls.push("bar"),
    modalForm: () => null,
  };
  const rq = run(src + ";requestCloseModal", ctx);
  assert.strictEqual(rq(), true); assert.deepStrictEqual(calls, ["close"]);
  calls.length = 0;
  assert.strictEqual(rq(() => calls.push("list")), true); assert.deepStrictEqual(calls, ["list"], "Cancel keeps its destination");
  calls.length = 0;
  ctx.modalForm = () => ({ isDirty: () => true });
  assert.strictEqual(rq(), false); assert.deepStrictEqual(calls, ["bar"]);
  calls.length = 0;
  let left = null;
  ctx.modalForm = () => ({ isDirty: () => false, leave: (d) => (left = d) });
  rq(); assert.deepStrictEqual(calls, ["close"]); assert.strictEqual(left, false);
  const bar = fnSource("showDirtyBar");
  for (const s of ["มีการแก้ไขที่ยังไม่บันทึก", "บันทึก", "ทิ้งการแก้ไข", "กลับไปแก้ต่อ"])
    assert.ok(bar.includes(`tr("${s}")`), "bar shows " + s);
  assert.doesNotMatch(bar, /\bconfirm\(/, "not the browser confirm()");
});

test("agentNavOrder = the ⚙ AGENTS order without the CEO", () => {
  const src = fnSource("agentListOrder") + ";" + fnSource("agentNavOrder") + ";({ agentListOrder, agentNavOrder })";
  const ctx = { ROSTER: { flow: {}, ceo: {}, nova: {}, main: {}, rex: {} } };
  const { agentListOrder, agentNavOrder } = run(src, ctx);
  assert.deepStrictEqual([...agentListOrder()], ["ceo", "main", "flow", "nova", "rex"]);
  assert.deepStrictEqual([...agentNavOrder()], ["main", "flow", "nova", "rex"]);
  ctx.ROSTER = { b: {}, a: {} };
  assert.deepStrictEqual([...agentNavOrder()], ["b", "a"], "registry order when there is no CEO/main");
  // the ⚙ AGENTS list uses the shared order — its own inline sort is gone, so they cannot drift
  const tab = fnSource("openSettings");
  assert.match(tab, /const rosterIds = agentListOrder\(\);/);
  assert.doesNotMatch(tab, /rosterOrder\.slice\(\)\.sort/, "no second copy of the order in the AGENTS tab");
});

test("navigation: wraps, saves dirty edits first, hidden for Hire/CEO", () => {
  const nav = fnSource("navAgent");
  assert.match(nav, /\(i \+ dir \+ order\.length\) % order\.length/, "wraps around");
  assert.match(nav, /f\.isDirty\(\)[\s\S]*saveAgentForm\(\{ close: false \}\)/, "saves before switching");
  assert.match(nav, /if \(!r\.ok\) \{ agentNavNote\("err", "✗ " \+ tr\("บันทึกไม่สำเร็จ"\), 2600\); flagFormField\(r\.field, r\.error\); return false; \}/,
    "a failed save stays put, says so on the pill and points at the field");
  assert.match(nav, /if \(f\.setBusy\) f\.setBusy\(true, dir\);/, "the pressed arrow spins while saving");
  assert.match(nav, /openEditor\([^;]*\{ restore: captureEditorState\(\), saved, savedName \}\)/);
  const ed = fnSource("openEditor");
  assert.match(ed, /const order = agentNavOrder\(\), at = id \? order\.indexOf\(id\) : -1;/);
  assert.match(ed, /form\.navigable = at >= 0 && order\.length > 1;/, "no ‹ › for ＋ Hire (id null) or the CEO");
  assert.match(ed, /showAgentNav\(\{ id, name: a\.name, n: at \+ 1, N: order\.length \}\);/, "n / N on the floating pill");
  assert.match(ed, /\} else hideAgentNav\(\);/, "＋ Hire / the CEO: no floating nav");
  assert.match(ed, /tr\("บันทึกแล้ว ✓"\)/);
  assert.doesNotMatch(ed, /edHead\.insertBefore|id="eNavPrev"|class="eNav"/, "the header nav is gone (✕ stays)");
  // view restore: after the render, then while the async sections settle
  assert.match(ed, /restoreEditorState\(nav\.restore\);\s*settleEditorView\(nav\.restore, form\);/);
  const cap = fnSource("captureEditorState");
  for (const k of ["scrollTop", "anchor: editorAnchor()", "selectionStart", "eSkillsSearch", "eToolsSearch"]) assert.ok(cap.includes(k), "captures " + k);
});

test("Alt+Arrow leaves macOS ⌥←/→ word jumps alone inside text fields", () => {
  const isTextField = run(fnSource("isTextField") + ";isTextField");
  assert.strictEqual(isTextField({ tagName: "INPUT", type: "text" }), true);
  assert.strictEqual(isTextField({ tagName: "INPUT", type: "search" }), true);
  assert.strictEqual(isTextField({ tagName: "INPUT", type: "checkbox" }), false);
  assert.strictEqual(isTextField({ tagName: "TEXTAREA" }), true);
  assert.strictEqual(isTextField({ tagName: "SELECT" }), false);
  assert.strictEqual(isTextField({ tagName: "DIV", isContentEditable: true }), true);
  assert.strictEqual(isTextField(null), false);
  const h = HTML.slice(HTML.indexOf('if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey'), HTML.indexOf('if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey') + 800);
  assert.ok(h.length > 100, "the Alt+Arrow handler exists");
  assert.match(h, /e\.key !== "ArrowLeft" && e\.key !== "ArrowRight"/);
  assert.match(h, /if \(IS_MAC && isTextField\(t\)\) return;/);
  assert.match(h, /navAgent\(e\.key === "ArrowRight" \? 1 : -1\)/);
});

test("dirty key ignores list order but not values", () => {
  const key = run(fnSource("agentFormKey") + ";agentFormKey");
  const a = { name: "A", skills: ["b", "a"], persona: { rules: "x" }, memoryPlugins: [] };
  assert.strictEqual(key(a), key({ name: "A", skills: ["a", "b"], persona: { rules: "x" }, memoryPlugins: [] }));
  assert.notStrictEqual(key(a), key({ ...a, persona: { rules: "y" } }));
  assert.notStrictEqual(key(a), key({ ...a, skills: ["a"] }));
});

test("SAVE keeps its behaviour through saveAgentForm", () => {
  const ed = fnSource("openEditor");
  assert.match(ed, /#eSave"\)\.onclick = async \(\) => \{\s*const r = await saveAgentForm\(\{ close: true \}\);/);
  const sv = fnSource("saveAgentForm");
  assert.match(sv, /uiPost\("\/registry\/agent", payload\)/);
  assert.match(sv, /if \(close\) \{\s*closeModal\(\);\s*if \(r\.id && !f\.isUser\) \{ ensureAgent\(r\.id\); setTarget\(r\.id\); \}/);
  assert.match(sv, /field: "eName"/); assert.match(sv, /field: "eProvider"/);
  // the payload keeps every field the old handler sent
  for (const k of ["role: roleSel.value", "avatar, aura: myAura", "tier:", "voice:", "provider:", "model:", "backend:",
    "expertise:", "personality:", "language:", "rules:", "skills: [...mySkills]", "tools: [...myTools]", "memoryPlugins: [...myMem]"])
    assert.ok(ed.includes(k), "payload has " + k);
});

test("＋ Hire draft storage is best-effort and keyed draft:hireAgent", () => {
  const src = 'const HIRE_DRAFT_KEY = "draft:hireAgent";' + fnSource("readHireDraft") + fnSource("writeHireDraft") +
    fnSource("dropHireDraft") + ";({ readHireDraft, writeHireDraft, dropHireDraft })";
  const store = new Map();
  const ok = run(src, { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, JSON, Date });
  assert.strictEqual(ok.readHireDraft(), null);
  assert.strictEqual(ok.writeHireDraft({ name: "Dora" }), true);
  assert.strictEqual(ok.readHireDraft().p.name, "Dora");
  ok.dropHireDraft(); assert.strictEqual(ok.readHireDraft(), null);
  store.set("draft:hireAgent", "{not json"); assert.strictEqual(ok.readHireDraft(), null);
  const boom = () => { throw new Error("blocked"); };
  const bad = run(src, { localStorage: { getItem: boom, setItem: boom, removeItem: boom }, JSON, Date });
  assert.strictEqual(bad.readHireDraft(), null);
  assert.strictEqual(bad.writeHireDraft({}), false);
  assert.doesNotThrow(() => bad.dropHireDraft());
  const ed = fnSource("openEditor");
  for (const s of ["มีร่างที่ค้างไว้", "กู้ร่าง", "ทิ้ง"]) assert.ok(ed.includes(`tr("${s}")`), "banner shows " + s);
});

test("every new string has curated en/zh/ja in one local block", () => {
  const at = HTML.indexOf("(() => { const D = {", HTML.indexOf("Curated en/zh/ja for the modal-guard"));
  assert.ok(at > 0, "the local DICT block exists");
  const lit = HTML.slice(HTML.indexOf("{", at + 18), HTML.indexOf("\n  };", at) + 4);
  const D = run("(" + lit + ")");
  for (const [k, v] of Object.entries(D))
    for (const l of ["en", "zh", "ja"]) assert.ok(v[l] && v[l].trim(), `${k} → ${l}`);
  for (const s of ["กด ✕ หรือ ยกเลิก เพื่อปิด", "มีการแก้ไขที่ยังไม่บันทึก", "บันทึก", "ทิ้งการแก้ไข", "กลับไปแก้ต่อ",
    "บันทึกแล้ว ✓", "มีร่างที่ค้างไว้", "กู้ร่าง", "ทิ้ง", "agent ก่อนหน้า", "agent ถัดไป", "บันทึกไม่สำเร็จ", "ต้องใส่ชื่อ",
    "บันทึกก่อนเปลี่ยน", "กำลังบันทึก…"])
    assert.ok(D[s], "curated: " + s);
  assert.match(HTML.slice(at, at + 3000), /for \(const \[k, v\] of Object\.entries\(D\)\) \{ DICT\[k\] = v; if \(LANG !== "th" && v\[LANG\]\) TR\[k\] = v\[LANG\]; \} \}\)\(\);/);
});


// ── floating ‹ n / N › (round 3): the counter pill on the card's top edge, ‹ › on its sides ──

test("floating nav: its own layer beside the card, clicks pass through, only the controls take them", () => {
  assert.ok(HTML.includes('<div id="modal"><div id="modalBox"><div id="modalCard"></div><div id="eFloat" hidden>'),
    "#modalBox = the card's own box; the layer is its sibling (a panel render never wipes it)");
  const layer = HTML.slice(HTML.indexOf('<div id="eFloat" hidden>'), HTML.indexOf("</div></div></div>", HTML.indexOf('<div id="eFloat" hidden>')));
  assert.match(layer, /<button type="button" class="eFArrow" id="eNavPrev">‹<\/button><div id="eNavPill" role="status" aria-live="polite">/);
  assert.match(layer, /<span class="msg" id="eNavMsg" hidden><\/span><span class="av" id="eNavAv"><\/span><b id="eNavName"><\/b><span id="eNavCount"><\/span><span class="dot" id="eNavDirty" hidden><\/span>/);
  assert.match(layer, /<button type="button" class="eFArrow" id="eNavNext">›<\/button>$/);
  assert.match(css, /#modalBox \{ position: relative; \}/);
  assert.match(css, /#eFloat \{ position: absolute; inset: 0; pointer-events: none; z-index: 3; \}/);
  assert.match(css, /#eFloat > \* \{ position: absolute; pointer-events: auto; \}/);
  assert.match(css, /#eFloat #eNavPill \{ left: 50%; top: 0; transform: translate\(-50%, -50%\);/, "the pill sits on the card's top edge");
  assert.match(css, /#eFloat \.eFArrow \{ top: 50%; width: 40px; height: 40px; margin: -20px 0 0 -20px;/, "arrows centred on the side edges at mid-height");
  assert.match(css, /#eFloat #eNavPrev \{ left: max\(0px, calc\(22px - \(100vw - 100%\) \/ 2\)\); \}/, "kept 22px inside a narrow window");
  assert.match(css, /#eFloat #eNavNext \{ left: min\(100%, calc\(100% - 22px \+ \(100vw - 100%\) \/ 2\)\); \}/);
  assert.match(css, /#modal\[data-form="agent"\] #dirtyBar \{ top: 16px; \}/, "the unsaved bar sticks under the pill");
  assert.doesNotMatch(css, /h3 \.eNav/, "the old header-nav styles are gone");
  const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(rm.slice(0, rm.indexOf("\n  }")), /#modal\.open #eFloat, #eFloat \.eFArrow\.spin::after \{ animation: none; \}/);
});

test("floating nav: wiring — arrows, caret kept in the field, hidden by any other panel, dirty dot", () => {
  assert.match(HTML, /document\.getElementById\("eNavPrev"\)\.onclick = \(\) => navAgent\(-1\);/);
  assert.match(HTML, /document\.getElementById\("eNavNext"\)\.onclick = \(\) => navAgent\(1\);/);
  assert.match(HTML, /for \(const bid of \["eNavPrev", "eNavNext"\]\) document\.getElementById\(bid\)\.addEventListener\("mousedown", \(e\) => e\.preventDefault\(\)\);/,
    "a mouse press on ‹ › leaves the caret in the field");
  assert.match(HTML, /new MutationObserver\(\(\) => \{ const f = _agentForm; if \(!\(f && f\.navigable && f\.alive\(\)\)\) hideAgentNav\(\); \}\)\.observe\(modalCard, \{ childList: true \}\);/);
  assert.match(HTML, /modalCard\.addEventListener\("focusin", \(e\) => \{ const fl = [^\n]*if \(fl\) _editorField = fl; \}\);/, "remembers the field last worked in");
  assert.match(fnSource("saveAgentForm"), /if \(f\.saved\) f\.saved\(payload\);\s*paintAgentNav\(\);/, "a save clears the dot");
  const show = fnSource("showAgentNav");
  for (const k of ['tr("agent ก่อนหน้า")', 'tr("agent ถัดไป")', 'tr("บันทึกก่อนเปลี่ยน")', 'tr("มีการแก้ไขที่ยังไม่บันทึก")', "npcOf(info.id)", 'info.n + " / " + info.N', "eFloat.hidden = false;"])
    assert.ok(show.includes(k), "showAgentNav: " + k);
  const busy = fnSource("setAgentNavBusy");
  assert.match(busy, /el\.classList\.toggle\("spin", !!b && d === dir\);/);
  assert.match(busy, /agentNavNote\("busy", "⏳ " \+ tr\("กำลังบันทึก…"\)\);/);
  const settle = fnSource("settleEditorView");
  assert.match(settle, /const evs = \["wheel", "touchstart", "pointerdown", "keydown"\];/, "the owner's own scroll / click / typing ends the re-alignment");
  assert.match(settle, /form\.ready\.then\(again\);/);
});

// A tiny layout stub: .field boxes at fixed offsets inside a scrolling card.
function layout({ cardTop = 100, cardH = 500, fields, focusId = null, scrollTop = 0 }) {
  const card = { scrollTop, contains: (x) => x === card || fs.includes(x) || fs.some((f) => f.kids.includes(x)),
    getBoundingClientRect: () => ({ top: cardTop, bottom: cardTop + cardH }),
    querySelectorAll: (sel) => (sel === ".field" ? fs : []),
    querySelector: (sel) => { const id = sel.slice(1); return fs.find((f) => f.id === id) || fs.flatMap((f) => f.kids).find((k) => k.id === id) || null; } };
  const fs = fields.map(([id, y, h = 60, shown = true]) => {
    const f = { id: "", offsetParent: shown ? card : null, classList: { contains: (c) => c === "field" }, kids: [] };
    const input = { id, classList: { contains: () => false }, closest: () => f, focus() {}, setSelectionRange() {} };
    f.kids.push(input);
    f.querySelector = () => input;
    f.getBoundingClientRect = () => ({ top: cardTop + y - card.scrollTop, bottom: cardTop + y + h - card.scrollTop });
    f.closest = () => f;
    f.isConnected = true;
    return f;
  });
  const active = focusId ? fs.flatMap((f) => f.kids).find((k) => k.id === focusId) : null;
  return { card, fs, active };
}
function anchorFns(L, extra = {}) {
  const src = ["editorFields", "editorFieldKey", "editorAnchor", "alignEditorAnchor"].map(fnSource).join("\n") + ";({ editorAnchor, alignEditorAnchor })";
  return run(src, { modalCard: L.card, document: { activeElement: L.active || { id: "" } }, _editorField: null, Math, ...extra });
}

test("same field, same height: the anchor is the focused field, else the last one worked in, else the top one", () => {
  // SYSTEM PROMPT at 300, 🛠 expertise at 460 — the owner is typing in the expertise box, scrolled so it sits 180px down
  let L = layout({ fields: [["eName", 40], ["ePrompt", 300, 140], ["eExpertise", 460], ["ePersonality", 560]], focusId: "eExpertise", scrollTop: 280 });
  let fns = anchorFns(L);
  assert.deepStrictEqual({ ...fns.editorAnchor() }, { key: "eExpertise", idx: 2, dy: 180 });
  // nothing focused → the first field still on screen
  L = layout({ fields: [["eName", 40], ["ePrompt", 300, 140], ["eExpertise", 460]], scrollTop: 280 });
  assert.deepStrictEqual({ ...anchorFns(L).editorAnchor() }, { key: "ePrompt", idx: 1, dy: 20 });
  // focus scrolled far out of view → not the anchor
  L = layout({ fields: [["eName", 40], ["ePrompt", 300], ["eRules", 1400]], focusId: "eRules", scrollTop: 0 });
  assert.strictEqual(anchorFns(L).editorAnchor().key, "eName");
});

test("same field, same height: the next agent's form scrolls so the field lands where it was", () => {
  // the next agent has a longer SYSTEM PROMPT box above: expertise now at 620 instead of 460
  const L = layout({ fields: [["eName", 40], ["ePrompt", 300, 300], ["eExpertise", 620], ["ePersonality", 720]], scrollTop: 0 });
  const fns = anchorFns(L);
  assert.strictEqual(fns.alignEditorAnchor({ anchor: { key: "eExpertise", idx: 2, dy: 180 } }), true);
  assert.strictEqual(L.card.scrollTop, 440, "620 − 440 = 180: the same height on screen");
  // a field this agent does not have → the same slot in the list
  L.card.scrollTop = 0;
  assert.strictEqual(fns.alignEditorAnchor({ anchor: { key: "eMemory", idx: 3, dy: 100 } }), true);
  assert.strictEqual(L.card.scrollTop, 620);
  // a hidden field is skipped for the index fallback; no anchor → false (scrollTop is the fallback)
  const H = layout({ fields: [["a", 0], ["b", 100, 60, false], ["c", 200]] });
  const h = anchorFns(H);
  assert.strictEqual(h.alignEditorAnchor({ anchor: { key: "zz", idx: 1, dy: 0 } }), true);
  assert.strictEqual(H.card.scrollTop, 200, "index 1 among the VISIBLE fields = c");
  assert.strictEqual(h.alignEditorAnchor({ anchor: null }), false);
  assert.strictEqual(h.alignEditorAnchor(null), false);
});

test("same field, same height: a shorter form gets room under the buttons (#eNavPad) instead of the field landing lower (live 2026-09-30)", () => {
  // a 1558 px window (card 1338 px): one agent's long form put 🛠 expertise 260 px down; another's form scrolls only 272 px
  const L = layout({ cardH: 1338, fields: [["eName", 40], ["eExpertise", 1006]], scrollTop: 0 });
  const pad = { style: {} };
  Object.defineProperty(pad, "offsetHeight", { get: () => parseInt(pad.style.height || "0", 10) });
  let content = 1610;
  Object.defineProperty(L.card, "scrollHeight", { get: () => content + pad.offsetHeight });
  L.card.clientHeight = 1338;
  const q = L.card.querySelector;
  L.card.querySelector = (sel) => (sel === "#eNavPad" ? pad : q(sel));
  const fns = anchorFns(L);
  assert.strictEqual(fns.alignEditorAnchor({ anchor: { key: "eExpertise", idx: 1, dy: 260 } }), true);
  assert.strictEqual(L.card.scrollTop, 746, "1006 − 746 = 260: the same height");
  assert.strictEqual(pad.style.height, "474px", "the form scrolls 272 px on its own; 474 px more under the buttons");
  // the async sections filled the form in: the room it has now is enough → the pad goes back to 0
  content = 2231;
  assert.strictEqual(fns.alignEditorAnchor({ anchor: { key: "eExpertise", idx: 1, dy: 260 } }), true);
  assert.deepStrictEqual([L.card.scrollTop, pad.style.height], [746, "0px"]);
  // the pad is the last thing in the Edit Agent form (a new render starts it at 0)
  assert.match(fnSource("openEditor"), /<button class="primary" id="eSave">💾 Save<\/button>\n\s*<\/div>\n\s*<div id="eNavPad" aria-hidden="true"><\/div>`;/);
});
