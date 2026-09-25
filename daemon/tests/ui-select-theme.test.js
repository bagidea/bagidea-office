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
  assert.match(OVERLAY, /<select id="bdOwner" style="flex:0 0 120px"><\/select>/);
});
