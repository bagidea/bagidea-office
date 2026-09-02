// Settings rows that cannot fit the settings panel.
//
// The panel is `#modalCard { width: min(470px, 92vw) }` with 16px padding, so a
// row inside it has ~426px to work with — less on a narrow chat window. A row
// is `display:flex` with no wrapping, so children pinned with `flex: 0 0 Npx`
// cannot give ground: the one flexible input absorbs the whole shortfall,
// collapses toward zero, and whatever is left over runs past the panel edge.
//
// That is not hypothetical. 🔎 SEMANTIC RECALL shipped in v1.0.0 with two
// pinned inputs totalling 340px; the endpoint box — the field you must fill —
// rendered at 22px, too narrow to show its own placeholder, and the Save button
// sat 26px outside the panel. Measured, not guessed.
//
// These tests are arithmetic on the markup, not a rendered layout: they catch
// the row that cannot fit, not every row that looks wrong.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "overlay.html"), "utf8");

// #modalCard is 470px wide with 16px padding either side, and the office's slim
// scrollbar takes a few more. Rows get about this much.
const ROW_WIDTH = 426;
const GAP = 6;                 // .assistrow { gap: 6px }
const BUTTON = 64;             // .sparkle — padding 0 16px around a short label

function rows() {
  // Every <div class="assistrow"> and the markup up to its closing tag. The
  // rows live inside JS template literals, so this reads text, not a DOM.
  const out = [];
  const re = /<div class="assistrow"([^>]*)>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(HTML))) out.push({ attrs: m[1], inner: m[2], at: m.index });
  return out;
}

function pinnedWidths(inner) {
  // `flex: 0 0 <n>px` — a child that will not shrink no matter how narrow the
  // panel gets. `flex: 1 1 <n>px` is a *preference* and is allowed to shrink.
  return [...inner.matchAll(/flex:\s*0\s+0\s+(\d+)px/g)].map((m) => Number(m[1]));
}

test("no settings row pins more width than the panel can give it", () => {
  const tooWide = [];
  for (const r of rows()) {
    const pinned = pinnedWidths(r.inner);
    if (!pinned.length) continue;
    const buttons = (r.inner.match(/<button/g) || []).length;
    const children = (r.inner.match(/<(input|select|button|textarea|span)/g) || []).length;
    // Pinned children + buttons + gaps, plus room for ONE flexible field to
    // still show its placeholder. Below that the row is unusable however it
    // renders.
    const floor = pinned.reduce((a, b) => a + b, 0) + buttons * BUTTON +
                  Math.max(0, children - 1) * GAP + 120;
    const wraps = /flex-wrap:\s*wrap/.test(r.attrs);
    if (floor > ROW_WIDTH && !wraps) {
      tooWide.push(`row at char ${r.at}: needs ~${floor}px of ${ROW_WIDTH}px ` +
                   `(pinned: ${pinned.join("+")}) and cannot wrap`);
    }
  }
  assert.deepStrictEqual(tooWide, [],
    "a settings row cannot fit the panel and has no way to wrap, so one field " +
    "collapses and the rest overflows:\n  " + tooWide.join("\n  "));
});

test("the SEMANTIC RECALL row keeps the endpoint readable", () => {
  // The endpoint is a URL. Sharing a line with two other inputs and a button is
  // how it ended up at 22px, so it gets its own line.
  const row = rows().find((r) => r.inner.includes('id="semUrl"'));
  assert.ok(row, "the SEMANTIC RECALL row is gone");
  assert.ok(/flex-wrap:\s*wrap/.test(row.attrs), "the row cannot wrap");
  assert.ok(/id="semUrl"[^>]*flex:\s*1\s+1\s+100%/.test(row.inner),
    "semUrl no longer takes a full line — it will be squeezed by its neighbours again");
  assert.strictEqual(pinnedWidths(row.inner).length, 0,
    "a field in this row is pinned again; pinned fields are what broke it");
});

test("the RUN LOCATION row keeps host and path readable in ssh mode", () => {
  // ssh reveals a fourth field, and four fields plus a button on one
  // unwrappable line left the host and the office path at 77px each.
  const row = rows().find((r) => r.inner.includes('id="bKind"'));
  assert.ok(row, "the RUN LOCATION row is gone");
  assert.ok(/flex-wrap:\s*wrap/.test(row.attrs), "the row cannot wrap");
  for (const id of ["bTarget", "bDir"]) {
    const m = row.inner.match(new RegExp('id="' + id + '"[^>]*style="([^"]*)"'));
    assert.ok(m, `${id} has no style — it will share whatever is left`);
    assert.ok(/flex:\s*\d+\s+1\s+1[0-9]{2}px/.test(m[1]),
      `${id} needs a basis of at least 100px so it can hold a real value`);
  }
});

test("every ALL-CAPS setting name the docs cite is still in the panel", () => {
  // The window is Thai-source and machine-translated at runtime, so the
  // ALL-CAPS English term is the part that survives — and the only name the
  // English docs and website can point at.
  for (const term of ["RUN LOCATION", "GHOST ISOLATION", "SEMANTIC RECALL",
                      "MCP SERVERS", "SYSTEM TOOLS", "API KEYS"]) {
    assert.ok(HTML.includes(term), `the panel no longer says "${term}"`);
  }
});
