// A <select> in the modal must carry the office theme, wherever it sits. The 📋 TASKS
// owner picker lived in an .assistrow outside any .field, and the assistrow rules
// themed inputs and textareas only — so it rendered as the browser's white control
// (reported with a screenshot, 2026-09-24). Guarded by the CSS rules themselves.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const OVERLAY = fs.readFileSync(path.join(__dirname, "..", "overlay.html"), "utf8");
const css = OVERLAY.slice(OVERLAY.indexOf("<style>"), OVERLAY.indexOf("</style>"));

test("selects in an .assistrow are themed like its inputs", () => {
  assert.match(css, /\.assistrow input, \.assistrow textarea, \.assistrow select \{/, "the assistrow control rule includes select");
  assert.match(css, /\.assistrow select:focus \{ border-color: var\(--accent\); \}/, "…and its focus ring");
});

test("every select inside the modal has the theme as a floor", () => {
  const m = /#modalCard select \{([^}]*)\}/.exec(css);
  assert.ok(m, "a #modalCard select rule exists");
  for (const prop of ["color: var(--text)", "background: rgba(255,255,255,0.05)", "border: 1px solid var(--line)", "color-scheme: dark"])
    assert.ok(m[1].includes(prop), "modal select rule sets " + prop);
  assert.match(css, /select option, select optgroup \{ background: #131c30; color: var\(--text\); \}/, "the dropdown list itself is dark");
});

test("the board's owner picker is the case that was reported", () => {
  // Still a bare <select> in the .assistrow (no .field around it) — the layout
  // of the row may change, the theme rules above must keep covering it.
  assert.match(OVERLAY, /<div class="assistrow"[^>]*>\s*<input id="bdTitle"[^>]*>\s*<select id="bdOwner" style="[^"]*"><\/select>/);
});

// 📋 The board was reported as crowded (2026-10-01): four equal columns in a
// 470px card gave each ~95px, two of them empty, and a title wrapped into a
// ten-line ribbon. These are the rules that fix it; losing one brings it back.
test("the task board is not four equal ribbons", () => {
  assert.match(css, /#modalCard:has\(#bdCols\) \{ width: min\(880px, 94vw\); \}/, "the card widens for the board tab only");
  assert.match(css, /\.board \{ display: flex;[^}]*overflow-x: auto;/, "the board scrolls sideways instead of squeezing");
  assert.match(css, /\.bcol \{ flex: 1 1 0; min-width: 200px;/, "a column has a readable minimum width");
  assert.match(css, /\.bcol\.empty \{ flex: 0 0 42px;/, "an empty column folds to a strip");
  assert.match(css, /\.bcol\.empty\.drop \{ flex-basis: 200px; \}/, "…and opens under a dragged card");
  assert.match(css, /\.card \.t \{[^}]*-webkit-line-clamp: 3;/, "a card title is clamped to three lines");
  assert.ok(!/repeat\(4, minmax\(0, 1fr\)\)/.test(css), "no fixed four-column grid");
  assert.match(OVERLAY, /col\.className = "bcol" \+ \(all\.length \? "" : " empty"\);/, "the fold follows the column's content");
  assert.match(OVERLAY, /c\.title = t\.title \+/, "the clamped title is whole in the tooltip");
  assert.match(OVERLAY, /const DONE_SHOWN = 6, folded = st === "done" && !_bdDoneAll && all\.length > DONE_SHOWN;/, "DONE lists the recent few until asked");
});
