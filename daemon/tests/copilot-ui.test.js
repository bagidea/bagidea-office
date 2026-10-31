// 🧠 Director-copilot UI (daemon/copilot-ui.js · SPEC2 C6) — static wiring + pure-logic checks.
// The picker itself is exercised end-to-end in jsdom by the dev UI harness (stubbed C5 API);
// these tests pin the contract pieces that must not silently regress:
//   · the daemon serves /copilot-ui.js (safe fallback); overlay.html + workflow.html load it
//   · the mount points: ✨ persona copilot (Create/Edit Agent), Workflow Builder toolbar + plan panel
//   · every POST carries the owner-UI header x-bagidea-ui
//   · labels name the ROLE ("Director", roleName()) — never the Director's own name, which can change
//   · every Thai string has curated en/zh/ja; errorText / request / settings / setBrain behave
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { spawnSync } = require("child_process");

const DAEMON = path.join(__dirname, "..");
const UI_FILE = path.join(DAEMON, "copilot-ui.js");
// Line endings normalised: a Windows checkout (core.autocrlf) has CRLF files.
const read = (f) => fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
const SRC = read(UI_FILE);
const SERVER = read(path.join(DAEMON, "server.js"));
const OVERLAY = read(path.join(DAEMON, "overlay.html"));
const BUILDER = read(path.join(DAEMON, "workflow.html"));
const THAI = /[฀-๿]/;
const plain = (x) => JSON.parse(JSON.stringify(x));   // objects made inside the VM have its own prototypes

// Minimal JS tokenizer: string literals, template-literal text chunks (with ${…} nesting),
// comments and regex literals — enough to find every piece of Thai text in copilot-ui.js.
function tokenize(src) {
  const strings = [], chunks = [], codeThai = [];
  const tpl = [];
  let i = 0, depth = 0, prev = "";
  const readTemplate = () => {
    let text = "";
    const start = i;
    while (i < src.length) {
      const c = src[i];
      if (c === "\\") { text += src.slice(i, i + 2); i += 2; continue; }
      if (c === "`") { i++; chunks.push({ text, start }); return "end"; }
      if (c === "$" && src[i + 1] === "{") { i += 2; chunks.push({ text, start }); return "expr"; }
      text += c; i++;
    }
    throw new Error("unterminated template literal at " + start);
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") { const j = src.indexOf("\n", i); i = j < 0 ? src.length : j; continue; }
    if (c === "/" && src[i + 1] === "*") { const j = src.indexOf("*/", i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1, v = "";
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") { v += src.slice(j, j + 2); j += 2; continue; }
        if (src[j] === "\n") throw new Error("newline inside a string literal at " + i);
        v += src[j]; j++;
      }
      strings.push({ value: v, start: i });
      i = j + 1; prev = "a"; continue;
    }
    if (c === "`") { i++; if (readTemplate() === "expr") tpl.push(depth); prev = "a"; continue; }
    if (c === "{") { depth++; i++; prev = "{"; continue; }
    if (c === "}") {
      if (tpl.length && tpl[tpl.length - 1] === depth) { tpl.pop(); i++; if (readTemplate() === "expr") tpl.push(depth); prev = "a"; continue; }
      depth--; i++; prev = "}"; continue;
    }
    if (c === "/") {
      if (!prev || prev === "kw" || /[(,=:[!&|?{;+\-*%<>~^]/.test(prev)) {
        let j = i + 1, cls = false;
        while (j < src.length) {
          const d = src[j];
          if (d === "\\") { j += 2; continue; }
          if (d === "\n") throw new Error("newline inside a regex literal at " + i);
          if (d === "[") cls = true; else if (d === "]") cls = false; else if (d === "/" && !cls) break;
          j++;
        }
        j++;
        while (/[a-z]/i.test(src[j] || "")) j++;
        i = j; prev = "a"; continue;
      }
      i++; prev = "/"; continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[\w$]/.test(c)) {
      let j = i;
      while (j < src.length && /[\w$]/.test(src[j])) j++;
      prev = /^(return|typeof|case|do|else|in|of|new|delete|void|throw|instanceof|yield|await)$/.test(src.slice(i, j)) ? "kw" : "a";
      i = j; continue;
    }
    if (THAI.test(c)) codeThai.push(i);
    prev = c; i++;
  }
  if (tpl.length) throw new Error("unbalanced template expression");
  return { strings, chunks, codeThai };
}

function dictBlock() {
  const a = SRC.indexOf("/* scp-i18n:begin */"), b = SRC.indexOf("/* scp-i18n:end */");
  assert.ok(a > 0 && b > a, "the local i18n block markers exist");
  const block = SRC.slice(a, b);
  const obj = block.slice(block.indexOf("{"), block.lastIndexOf("}") + 1);
  return { start: a, end: b, dict: vm.runInNewContext("(" + obj + ")") };
}

// Source of overlay.html's top-level `function name(…) { … }`, brace-matched (as edit-agent-nav).
function fnSource(name) {
  const m = new RegExp("\\n  (?:async )?function " + name + "\\(").exec(OVERLAY);
  assert.ok(m, name + "() is missing from overlay.html");
  let depth = 0;
  for (let j = OVERLAY.indexOf(") {", m.index) + 2; j < OVERLAY.length; j++) {
    if (OVERLAY[j] === "{") depth++;
    else if (OVERLAY[j] === "}" && --depth === 0) return OVERLAY.slice(m.index + 1, j + 1);
  }
  throw new Error("unbalanced braces in " + name);
}

// ── a fake page to run the module in ─────────────────────────────────────────
function fakeResponse(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => JSON.parse(text) };
}
function loadModule({ lang, routes = {} } = {}) {
  const calls = [];
  const window = {
    addEventListener() {},
    fetch: async (url, opts = {}) => {
      const method = String(opts.method || "GET").toUpperCase();
      calls.push({ url: String(url), method, headers: { ...(opts.headers || {}) }, body: opts.body ? JSON.parse(opts.body) : null });
      const h = routes[method + " " + url];
      if (!h) return fakeResponse(404, "not found");
      const r = typeof h === "function" ? h(calls[calls.length - 1]) : h;
      if (r === "throw") throw new TypeError("Failed to fetch");
      return fakeResponse(r[0], r[1]);
    },
  };
  const ctx = { window, setTimeout: () => 0, clearTimeout() {}, console };
  if (lang) ctx.LANG = lang;
  vm.runInNewContext(SRC, ctx);
  assert.ok(window.ShinoCopilot, "the file defines window.ShinoCopilot");
  return { SC: window.ShinoCopilot, calls, window };
}
const SETTINGS = {
  provider: "", model: "",
  effective: { provider: "claude", model: "claude-fable-5-1", label: "Claude · Anthropic", source: "director" },
  director: { id: "main", name: "Kaito", provider: "claude", model: "claude-fable-5-1" },
  providers: [
    { id: "claude", label: "Claude · Anthropic", group: "claude", connected: true, running: null, models: ["claude-fable-5-1"] },
    { id: "lmstudio", label: "LM Studio · local", group: "local", connected: true, running: true, models: ["qwen-test-27b"] },
  ],
};

// ── wiring ───────────────────────────────────────────────────────────────────
test("the daemon serves /copilot-ui.js right after /md.js, with a safe fallback", () => {
  const prev = SERVER.indexOf('req.method === "GET" && req.url.split("?")[0] === "/md.js"');
  const route = SERVER.indexOf('req.method === "GET" && req.url.split("?")[0] === "/copilot-ui.js"');
  assert.ok(prev > 0 && route > prev, "the /copilot-ui.js route exists after /md.js");
  assert.strictEqual((SERVER.slice(prev, route).match(/\} else if \(/g) || []).length, 1, "it is the very next route");
  const block = SERVER.slice(route, SERVER.indexOf("} else if (req.", route));
  assert.match(block, /"content-type": "text\/javascript; charset=utf-8", "cache-control": "no-store"/);
  assert.match(block, /fs\.readFileSync\(path\.join\(__dirname, "copilot-ui\.js"\)\)/);
  const fb = /catch \{ res\.end\(("(?:[^"\\]|\\.)*")\); \}/.exec(block);
  assert.ok(fb, "a fallback body is served when the file is missing");
  const window = {};
  vm.runInNewContext(JSON.parse(fb[1]), { window });
  assert.strictEqual(window.ShinoCopilot, null, "the fallback leaves the pages on their plain behaviour");
  assert.strictEqual(SERVER.split('"/copilot-ui.js"').length - 1, 1, "one route");
});

test("overlay.html loads /copilot-ui.js after its main script; workflow.html before its main script", () => {
  const tag = '<script src="/copilot-ui.js"></script>';
  assert.strictEqual(OVERLAY.split(tag).length - 1, 1, "exactly one tag in the overlay");
  assert.ok(OVERLAY.includes("</script>\n" + tag + "\n</html>"), "…directly after the main script, last in the page");
  assert.ok(OVERLAY.indexOf(tag) < OVERLAY.indexOf("</html>"));
  assert.strictEqual(BUILDER.split(tag).length - 1, 1, "exactly one tag in the Workflow Builder");
  const at = BUILDER.indexOf(tag);
  assert.ok(BUILDER.indexOf('<script src="/md.js"></script>') < at && at < BUILDER.indexOf("<script>\n"), "after md.js, before the inline script");
});

test("copilot-ui.js passes node --check", () => {
  const r = spawnSync(process.execPath, ["--check", UI_FILE], { encoding: "utf8" });
  assert.strictEqual(r.status, 0, r.stderr);
});

test("mount points: ✨ persona copilot in Create/Edit Agent", () => {
  const ed = fnSource("openEditor");   // still brace-matchable (edit-agent-nav relies on it)
  const field = ed.slice(ed.indexOf('<div class="field" id="eCopilot">'), ed.indexOf("SYSTEM PROMPT"));
  assert.ok(field.includes("✨ PERSONA COPILOT"), "the field keeps its label");
  assert.match(field, /<div id="eCopilotPick"><\/div>[\s\S]*id="eBrief"[\s\S]*id="eAssist"[\s\S]*<div id="eAssistMsg" class="scp-msg" role="status" aria-live="polite" hidden><\/div>/,
    "picker above the brief + button, result line below");
  assert.match(ed, /SC\.mountPicker\(modalCard\.querySelector\("#eCopilotPick"\), \{ onChange: paintAssist \}\)/);
  assert.match(ed, /aBtn\.textContent = cpT\("✨ ให้ \{name\} ร่าง persona", \{ name: cpName\(\) \}\)/, "the button says Director");
  assert.match(ed, /aBtn\.textContent = "⏳ " \+ cpT\("\{name\} กำลังร่าง…", \{ name: cpName\(\) \}\)/, "loading says Director");
  assert.match(ed, /const cpName = \(\) => \(SC && typeof SC\.roleName === "function" \? SC\.roleName\(\) : "Director"\);/,
    "the role word, never SC.directorName()");
  assert.ok(!/directorName/.test(ed.slice(ed.indexOf("const SC = window.ShinoCopilot"), ed.indexOf("} finally { aBtn.disabled = false; paintAssist(); }"))),
    "the persona copilot never shows the Director's own name");
  assert.match(ed, /SC\.request\("\/assist\/prompt", body\)/, "the POST goes through request() (x-bagidea-ui)");
  assert.match(ed, /: \{ ok: true, data: await api\("\/assist\/prompt", body, true\) \}/, "without the module: the overlay's api() (x-bagidea-ui)");
  assert.match(ed, /SC\.notice\(aMsg, \{ title: "ร่าง persona ไม่สำเร็จ", error: res\.error, brain: res\.brain,\s*report: \{ source: "copilot", step: "ร่าง persona" \} \}\)/,
    "errors: readable + report to the dev team");
  assert.match(ed, /SC\.notice\(aMsg, \{ brain: res\.brain, done: "ร่างโดย \{brain\}" \}\)/, "success shows the brain");
  // the fill logic is kept, and only reaches the form that asked
  const h = ed.slice(ed.indexOf("aBtn.onclick = async () => {"), ed.indexOf("} finally { aBtn.disabled = false; paintAssist(); }"));
  assert.ok(h.indexOf("if (!aBtn.isConnected) return;") > 0 && h.indexOf("if (!aBtn.isConnected) return;") < h.indexOf('#ePrompt").value = r.prompt'), "late replies are dropped");
  for (const k of ['#ePrompt").value = r.prompt', '#eExpertise").value = r.expertise', '#ePersonality").value = r.personality',
    '#eLanguage").value = r.language', '#eRules").value = r.rules', "mySkills.clear(); r.skills.forEach((s) => mySkills.add(s)); renderSkillChips();",
    "myTools.clear(); r.tools.forEach((t) => myTools.add(t)); renderToolChips();"])
    assert.ok(h.includes(k), "fills " + k);
  assert.doesNotMatch(ed, /thinking…|"✨ Draft"/, "the old labels are gone");
});

test("mount points: Workflow Builder toolbar + analyze panel, renamed buttons", () => {
  assert.match(BUILDER, /<button id="draftBtn" onclick="draftWf\(\)">🪄 ให้ Director ร่าง<\/button>\n\s*<div id="cpBarPick" class="cp-pick" style="flex:2 1 0;min-width:240px;max-width:460px"><\/div>/, "picker next to the draft button (grows into free space, never forces a wrap)");
  assert.match(BUILDER, /<h3 id="planTitle">🤖 แผนจาก Director<\/h3>\n\s*<div id="cpPlanPick" class="cp-pick" style="flex:none"><\/div>/, "picker under the plan title");
  assert.ok(!BUILDER.includes("ร่างด้วย Director"), "the old button text is gone");
  assert.match(BUILDER, /ShinoCopilot\.mountPicker\(document\.getElementById\("cpBarPick"\), \{ compact: true, inline: true \}\);/, "one-row toolbar picker");
  assert.match(BUILDER, /ShinoCopilot\.mountPicker\(document\.getElementById\("cpPlanPick"\), \{ compact: true \}\);/);
  assert.match(BUILDER, /ShinoCopilot\.onChange\(paintDirector\);/);
  assert.match(BUILDER, /b\.textContent = trn\("🪄 ให้ \{name\} ร่าง"\)/);
  assert.match(BUILDER, /h\.textContent = trn\("🤖 แผนจาก \{name\}"\)/);
  assert.match(BUILDER, /function rerenderAll\(\)\{[^\n]*\n\s*paintDirector\(\); if \(window\.ShinoCopilot\) ShinoCopilot\.relabel\(\); \}/, "a late language switch relabels");
  assert.match(BUILDER, /copilotPost\("\/workflows\/draft", \{ goal \}\)/);
  assert.match(BUILDER, /copilotPost\("\/workflows\/analyze", \{ name: nameInp\.value, nodes, edges \}\)/);
  assert.match(BUILDER, /btn\.textContent=trn\("⏳ \{name\} กำลังร่าง…"\)/, "draft loading names the Director");
  assert.match(BUILDER, /plan\.textContent = trn\("⏳ \{name\} กำลังวิเคราะห์…"\)/, "analyze loading names the Director");
  assert.match(BUILDER, /copilotNote\(plan, \{ brain:r\.brain, done:"ร่างโดย \{brain\}" \}\)/);
  assert.match(BUILDER, /copilotNote\(plan, \{ brain:r\.brain, done:"วิเคราะห์โดย \{brain\}" \}\)/);
  // every new Thai string of the builder has English in its own TR map (placeholders kept)
  for (const [th, en] of [["🪄 ให้ {name} ร่าง", "🪄 Let the {name} draft"], ["⏳ {name} กำลังร่าง…", "⏳ The {name} is drafting…"],
    ["🤖 แผนจาก {name}", "🤖 The {name}'s plan"], ["⏳ {name} กำลังวิเคราะห์…", "⏳ The {name} is analyzing…"],
    ["🪄 {name} กำลังร่าง workflow…", "🪄 The {name} is drafting a workflow…"],
    ["อยากได้ workflow ทำอะไร? พิมพ์เป้าหมายสั้นๆ — {name} จะร่างให้", "What should the workflow do? Type a short goal — the {name} will draft it."],
    ["ร่างไม่สำเร็จ", "Draft failed"], ["วิเคราะห์ไม่สำเร็จ", "Analysis failed"], ["ร่างโดย {brain}", "Drafted by {brain}"], ["วิเคราะห์โดย {brain}", "Analyzed by {brain}"]])
    assert.ok(BUILDER.includes(JSON.stringify(th) + ":" + JSON.stringify(en)), "builder TR: " + th);
  const region = BUILDER.slice(BUILDER.indexOf("// 🧠 Director copilot"), BUILDER.indexOf("async function saveWf()"));
  for (const m of region.matchAll(/\btrn?\("([^"]+)"\)/g)) assert.ok(BUILDER.includes(JSON.stringify(m[1]) + ":"), "English for " + m[1]);
});

test("every POST carries the owner-UI header x-bagidea-ui", async () => {
  const fetches = SRC.match(/\bfetch\(/g) || [];
  assert.strictEqual(fetches.length, 2, "two fetch sites: settings (GET) and request (POST)");
  assert.strictEqual((SRC.match(/method: "POST"/g) || []).length, 1, "one POST site");
  const at = SRC.indexOf('method: "POST"');
  assert.match(SRC.slice(SRC.lastIndexOf("fetch(", at), at + 80), /method: "POST", headers: \{ \.\.\.HDR \}/);
  assert.match(SRC, /const HDR = \{ "content-type": "application\/json", "x-bagidea-ui": "1" \};/);
  assert.ok(!/\b(api|uiPost)\(|XMLHttpRequest|sendBeacon/.test(SRC), "no other POST path");
  const region = BUILDER.slice(BUILDER.indexOf("// 🧠 Director copilot"), BUILDER.indexOf("async function saveWf()"));
  assert.match(region, /headers:\{ "content-type":"application\/json", "x-bagidea-ui":"1" \}/, "the builder's fallback POST has it too");
  assert.strictEqual((region.match(/\bfetch\(/g) || []).length, 1, "the builder's only direct fetch is that fallback");
  // and at runtime
  const { SC, calls } = loadModule({ routes: {
    "POST /copilot/settings": [200, { ok: true, effective: { provider: "lmstudio", model: "qwen-test-27b", label: "LM Studio · local", source: "copilot" } }],
    "GET /copilot/settings": [200, SETTINGS],
    "POST /assist/prompt": [200, { prompt: "x", brain: { provider: "claude", model: "m" } }] } });
  await SC.setBrain("lmstudio", "qwen-test-27b");
  await SC.request("/assist/prompt", { brief: "b" });
  const posts = calls.filter((c) => c.method === "POST");
  assert.strictEqual(posts.length, 2);
  for (const p of posts) assert.strictEqual(p.headers["x-bagidea-ui"], "1", p.url);
});

test("labels say the role \"Director\" whatever the Director is called (it can be renamed)", async () => {
  for (const [what, src] of [["copilot-ui.js", SRC], ["workflow.html", BUILDER],
    ["overlay persona copilot", OVERLAY.slice(OVERLAY.indexOf('<div class="field" id="eCopilot">'), OVERLAY.indexOf("} finally { aBtn.disabled = false; paintAssist(); }"))]]) {
    const bad = [...src.matchAll(/Shino(?!Copilot)/gi)].map((m) => src.slice(Math.max(0, m.index - 30), m.index + 30));
    assert.deepStrictEqual(bad, [], what + " names the Director");
  }
  const { SC } = loadModule({ routes: { "GET /copilot/settings": [200, SETTINGS] } });
  assert.strictEqual(SC.roleName(), "Director", "the role word before the settings arrive");
  await SC.settings();
  assert.strictEqual(SC.directorName(), "Kaito", "the actual name is still known (not used for labels)");
  assert.strictEqual(SC.roleName(), "Director", "…and the labels keep the role word after a rename");
  assert.strictEqual(SC.t("✨ ให้ {name} ร่าง persona", { name: SC.roleName() }), "✨ ให้ Director ร่าง persona");
  // every label site in the module passes the role, never directorName()
  for (const m of SRC.matchAll(/name: (\w+)\(\)/g)) assert.strictEqual(m[1], "roleName", "a label filled with " + m[1] + "()");
  assert.match(SRC, /const d = S\.data, name = roleName\(\);\n\s*const lead = T\("\{name\} ใช้"\)\.split\("\{name\}"\);/, "the picker lead: 🧠 Director ใช้");
  assert.match(SRC, /t: T, roleName, directorName, brainText, request, notice, relabel,/, "roleName() is public for the host pages");
});

test("i18n: every Thai string has curated en/zh/ja in the local block (placeholders kept)", () => {
  const { start, end, dict } = dictBlock();
  for (const [k, v] of Object.entries(dict)) {
    assert.ok(THAI.test(k), "keys are Thai source strings: " + k);
    const slots = (s) => (s.match(/\{\w+\}/g) || []).sort().join();
    for (const l of ["en", "zh", "ja"]) {
      assert.ok(typeof v[l] === "string" && v[l].trim() && !THAI.test(v[l]), `${l} for "${k}"`);
      assert.strictEqual(slots(v[l]), slots(k), `${l} keeps the placeholders of "${k}"`);
    }
  }
  const { strings, chunks, codeThai } = tokenize(SRC);
  assert.deepStrictEqual(codeThai, [], "no Thai outside string literals");
  assert.deepStrictEqual(chunks.filter((c) => THAI.test(c.text)).map((c) => c.text.trim().slice(0, 60)), [], "no Thai inside template literals");
  const missing = strings.filter((s) => (s.start < start || s.start > end) && THAI.test(s.value) && !dict[s.value]).map((s) => s.value);
  assert.deepStrictEqual([...new Set(missing)], [], "Thai strings without a curated translation");
  // strings the overlay hands to ShinoCopilot.t() / notice() are curated here too
  const ed = fnSource("openEditor");
  const region = ed.slice(ed.indexOf("const SC = window.ShinoCopilot"), ed.indexOf("} finally { aBtn.disabled = false; paintAssist(); }"));
  const used = [...region.matchAll(/cpT\("([^"]+)"|(?:title|done|step): "([^"]+)"/g)].map((m) => m[1] || m[2]);
  assert.ok(used.length >= 5, "found the overlay's copilot strings");
  for (const s of used) assert.ok(dict[s], "curated: " + s);
  // …and the overlay merges them into its DICT / TR (never overriding its own entries)
  assert.match(SRC, /if \(!DICT\[k\]\) DICT\[k\] = v;\s*if \(LANG !== "th" && DICT\[k\]\[LANG\]\) TR\[k\] = DICT\[k\]\[LANG\];/);
});

test("t(): the UI language, curated first, host tr() next, English last", () => {
  assert.strictEqual(loadModule().SC.t("บันทึกแล้ว"), "บันทึกแล้ว", "Thai stays Thai");
  const en = loadModule({ lang: "en" }).SC;
  assert.strictEqual(en.t("{name} ใช้", { name: "Director" }), "The Director uses");
  assert.strictEqual(loadModule({ lang: "ja" }).SC.t("บันทึกแล้ว"), "保存しました");
  assert.strictEqual(loadModule({ lang: "ko" }).SC.t("บันทึกแล้ว"), "Saved", "an uncurated language falls back to English");
  assert.strictEqual(en.t("ข้อความอื่น"), "ข้อความอื่น", "unknown strings pass through (the host translates them)");
});

test("errorText(): readable text for every C5 error code and every failure shape", () => {
  const { SC } = loadModule();
  const codes = ["NOT_CONNECTED", "AUTH", "MODEL_NOT_FOUND", "TIMEOUT", "NETWORK", "EMPTY", "BAD_JSON", "UPSTREAM"];
  const seen = new Set();
  for (const code of codes) {
    const t = SC.errorText({ code, message: "raw detail" });
    assert.ok(THAI.test(t) && !/undefined|null|\[object/.test(t), code + " → " + t);
    assert.ok(t.endsWith("\nraw detail"), "the raw detail is kept on line 2");
    seen.add(t.split("\n")[0]);
  }
  assert.strictEqual(seen.size, codes.length, "one distinct message per code");
  assert.match(SC.errorText({ code: "AUTH" }), /401\/403/);
  assert.match(SC.errorText({ ok: false, error: { code: "TIMEOUT", message: "120 s" }, brain: {} }), /^รอคำตอบนานเกินไป[^\n]*\n120 s$/, "a whole 502 body");
  assert.match(SC.errorText(Object.assign(new TypeError("Failed to fetch"))), /^ติดต่อออฟฟิศไม่ได้/, "fetch's TypeError = the office is offline");
  assert.strictEqual(SC.errorText({ code: "HTTP", status: 500, message: "<h1>boom</h1>" }), "ออฟฟิศตอบกลับด้วยข้อผิดพลาด (HTTP 500)\nboom", "text 500, tags stripped");
  assert.match(SC.errorText("AUTH"), /401\/403/, "a bare code");
  assert.match(SC.errorText({ code: "RATE_LIMIT" }), /\(RATE_LIMIT\)$/, "an unknown code is still readable and named");
  assert.match(SC.errorText(null), /^ทำไม่สำเร็จ/);
  assert.ok(SC.errorText({ code: "NETWORK", message: "x".repeat(900) }).length < 420, "long raw text is clipped");
  const en = loadModule({ lang: "en" }).SC;
  for (const code of codes.concat(["OFFLINE", "HTTP", "BAD_RESPONSE", "BAD_MODEL", "WHATEVER"]))
    assert.ok(!THAI.test(en.errorText({ code, message: "raw" })), "English for " + code);
});

test("request(): 502 JSON, text 500, 200 { ok:false }, offline and success all come back as data", async () => {
  const brain = { provider: "gemini", model: "gemini-3-pro", label: "Gemini" };
  const { SC } = loadModule({ routes: {
    "POST /a": [502, { ok: false, error: { code: "AUTH", message: "401 bad key" }, brain }],
    "POST /b": [500, "claude exited with code 1"],
    "POST /c": [200, { ok: false, analysis: "วิเคราะห์ไม่สำเร็จ" }],
    "POST /d": "throw",
    "POST /e": [200, { prompt: "p", brain }],
    "POST /f": [200, "<html>not json</html>"] } });
  const a = await SC.request("/a", {});
  assert.deepStrictEqual(plain({ ok: a.ok, status: a.status, error: a.error, brain: a.brain }), { ok: false, status: 502, error: { code: "AUTH", message: "401 bad key", status: 502 }, brain });
  const b = await SC.request("/b", {});
  assert.deepStrictEqual(plain(b.error), { code: "HTTP", message: "claude exited with code 1", status: 500 });
  assert.strictEqual((await SC.request("/c", {})).error.code, "FAILED");
  const d = await SC.request("/d", {});
  assert.strictEqual(d.error.code, "OFFLINE"); assert.strictEqual(d.status, 0);
  const e = await SC.request("/e", {});
  assert.ok(e.ok && e.data.prompt === "p"); assert.deepStrictEqual(plain(e.brain), brain);
  assert.strictEqual((await SC.request("/f", {})).error.code, "BAD_RESPONSE");
  assert.strictEqual(SC.brainText(brain), "Gemini / gemini-3-pro");
  assert.strictEqual(SC.brainText({ provider: "x", model: "m", label: "X · m" }), "X · m", "a label that already names the model");
  assert.strictEqual(SC.brainText(null), "");
});

test("settings(): cached 10 s, force refetches, onChange on the first load and on every save", async () => {
  let n = 0;
  const cur = JSON.parse(JSON.stringify(SETTINGS));
  const { SC, calls } = loadModule({ routes: {
    "GET /copilot/settings": () => { n++; return [200, cur]; },
    "POST /copilot/settings": (c) => [200, { ok: true, effective: { provider: c.body.provider, model: c.body.model, label: "LM Studio · local", source: "copilot" } }] } });
  const seen = [];
  const off = SC.onChange((s) => seen.push([s.provider, s.model]));
  const s1 = await SC.settings();
  assert.strictEqual(s1.director.name, "Kaito");
  await SC.settings();
  assert.strictEqual(n, 1, "cached");
  await SC.settings(true);
  assert.strictEqual(n, 2, "force refetches");
  assert.deepStrictEqual(seen, [["", ""]], "one change: the first load (an identical refetch is silent)");
  await SC.setBrain("lmstudio", "  qwen-test-27b  ");
  assert.deepStrictEqual(calls.filter((c) => c.method === "POST").map((c) => c.body), [{ provider: "lmstudio", model: "qwen-test-27b" }], "trimmed body");
  assert.deepStrictEqual(seen.at(-1), ["lmstudio", "qwen-test-27b"], "subscribers see the save");
  const s2 = await SC.settings();
  assert.deepStrictEqual([s2.provider, s2.model, s2.effective.provider], ["lmstudio", "qwen-test-27b", "lmstudio"], "the snapshot follows the save");
  await SC.setBrain("director", "ignored");
  assert.deepStrictEqual(calls.filter((c) => c.method === "POST").at(-1).body, { provider: "", model: "" }, '"director" = follow the Director');
  off();
  await SC.setBrain("lmstudio", "x");
  assert.deepStrictEqual(seen.at(-1), ["", ""], "unsubscribed");
  // invalid ids never leave the page
  const before = calls.length;
  await assert.rejects(SC.setBrain("lmstudio", "m".repeat(161)), (e) => e.code === "BAD_MODEL");
  await assert.rejects(SC.setBrain("lmstudio", "bad id!"), (e) => e.code === "BAD_MODEL");
  assert.strictEqual(calls.length, before, "nothing was sent");
  await SC.setBrain("lmstudio", "m".repeat(160));                  // 160 is fine
  await SC.setBrain("lmstudio", "qwen-test-27b@q4_0");
  await SC.setBrain("openrouter", "openai/gpt-oss-20b:free");
  // a refused save throws the C5 error (the picker shows it and reverts)
  const r = loadModule({ routes: { "POST /copilot/settings": [400, { ok: false, error: { code: "BAD_PROVIDER", message: "unknown provider" } }] } });
  await assert.rejects(r.SC.setBrain("nope", ""), (e) => e.code === "BAD_PROVIDER" && e.status === 400);
});

test("settings(): a failed load rejects (pickers show ↻), a later success recovers", async () => {
  let up = false;
  const { SC } = loadModule({ routes: { "GET /copilot/settings": () => (up ? [200, SETTINGS] : [404, "not found"]) } });
  await assert.rejects(SC.settings(), (e) => e.code === "HTTP" && e.status === 404);
  up = true;
  const s = await SC.settings();
  assert.strictEqual(s.director.name, "Kaito");
  up = false;
  const again = await SC.settings(true);
  assert.strictEqual(again.director.name, "Kaito", "a failed refetch keeps the last good snapshot");
});

// The Workflow Builder's own i18n + role-word helpers, lifted out of workflow.html and run in a VM
// exactly as the page defines them (TR, HINTS, tr, dirName, trn, nodeHint).
function builderNames({ lang = "th", copilot, wl = null } = {}) {
  const grab = (re, what) => { const m = re.exec(BUILDER); assert.ok(m, what + " found in workflow.html"); return m[0]; };
  const trAt = BUILDER.indexOf("  const TR = {"), hintsAt = BUILDER.indexOf("  const HINTS = {");
  assert.ok(trAt > 0 && hintsAt > 0, "TR + HINTS found");
  const src = [
    "var TR = " + BUILDER.slice(BUILDER.indexOf("{", trAt), BUILDER.indexOf("\n  };", trAt) + 4) + ";",
    "var HINTS = " + BUILDER.slice(BUILDER.indexOf("{", hintsAt), BUILDER.indexOf("};", hintsAt) + 1) + ";",
    grab(/  function tr\(s\)\{[\s\S]*?\n  \}/, "tr()"),
    grab(/  function dirName\(\)\{.*\}/, "dirName()"),
    grab(/  function trn\(s\)\{.*\}/, "trn()"),
    grab(/  function nodeHint\(type\)\{.*\}/, "nodeHint()"),
  ].join("\n");
  const ctx = { window: copilot ? { ShinoCopilot: copilot } : {}, ShinoCopilot: copilot, LANG: lang, WL: wl };
  vm.runInNewContext(src, ctx);
  return ctx;
}

test("Workflow Builder: every copilot label says Director, whatever the Director is called (translated, then filled)", () => {
  const HINT = "กด “วิเคราะห์” แล้ว {name} จะอ่าน workflow (รวมการแตกแขนง/รวม) แล้วบอกว่าต้องใช้ skill/tool/permission อะไร และมอบหมายให้ใคร";
  const HINT_EN = "Press “Analyze” and the {name} reads the workflow (branches & merges) and tells you which skills/tools/permissions it needs and who to assign.";
  const DEC = "เงื่อนไข เช่น {{n2.output.status}} == 200 หรือคำถาม ให้ {name} ตอบ YES/NO";
  // wiring: an empty slot painted by paintDirector (the relabel path), no hard-coded Director text left
  assert.ok(BUILDER.includes('<div class="muted" id="planHint"></div>'), "the hint is a slot the page paints");
  assert.ok(!BUILDER.includes("Director จะอ่าน") && !BUILDER.includes("ให้ Director ตอบ"), "no hard-coded Director in the hint / decision text");
  const at = BUILDER.indexOf("  function paintDirector(){");
  const paint = BUILDER.slice(at, BUILDER.indexOf("\n  }\n", at));
  assert.ok(paint.includes('const p = document.getElementById("planHint"); if (p) p.textContent = trn(' + JSON.stringify(HINT) + ");"),
    "paintDirector paints the hint as text");
  assert.match(paint, /if \(n && ta\) ta\.placeholder = nodeHint\(n\.type\);/, "…and the placeholders of the nodes on the canvas");
  assert.ok(BUILDER.includes(JSON.stringify(HINT) + ":\n      " + JSON.stringify(HINT_EN) + ","), "English template for the hint");
  assert.ok(BUILDER.includes(JSON.stringify(DEC) + ":" + JSON.stringify("A condition like {{n2.output.status}} == 200, or a question the {name} answers YES/NO")));
  assert.ok(BUILDER.includes("decision:" + JSON.stringify(DEC) + ","), "the decision hint keeps its meaning, names the Director");
  assert.ok(BUILDER.includes('`<textarea placeholder="${esc(nodeHint(n.type))}">'), "a new node's placeholder (escaped)");
  assert.ok(BUILDER.includes('el.querySelector("textarea").placeholder = nodeHint(n.type); };'), "…and after a type change");
  assert.ok(!/regDir|cpNamed|directorName/.test(BUILDER), "the Director's own name is never read for a label");
  assert.match(BUILDER, /function dirName\(\)\{ return window\.ShinoCopilot && typeof ShinoCopilot\.roleName === "function" \? ShinoCopilot\.roleName\(\) : "Director"; \}/);
  // runtime: translate the template, then put the role word in — a Director called Shino still reads "Director"
  const sc = { roleName: () => "Director", directorName: () => "Shino" };
  const th = builderNames({ copilot: sc });
  assert.strictEqual(th.trn(HINT), HINT.replace("{name}", "Director"));
  assert.strictEqual(th.nodeHint("decision"), "เงื่อนไข เช่น {{n2.output.status}} == 200 หรือคำถาม ให้ Director ตอบ YES/NO");
  assert.strictEqual(th.nodeHint("fetch"), "URL ที่จะดึง เช่น https://api.example.com/items", "other hints untouched");
  assert.strictEqual(th.nodeHint("plugin-kind"), "พิมพ์สิ่งที่อยากให้ทำ…");
  const en = builderNames({ lang: "en", copilot: sc });
  assert.strictEqual(en.trn(HINT), HINT_EN.replace("{name}", "Director"));
  assert.strictEqual(en.nodeHint("decision"), "A condition like {{n2.output.status}} == 200, or a question the Director answers YES/NO");
  assert.strictEqual(en.nodeHint("fetch"), "URL to fetch, e.g. https://api.example.com/items");
  // an auto-translated language whose copy lost the {name} slot → the English template, filled
  const ja = builderNames({ lang: "ja", copilot: sc, wl: { map: { [HINT]: "「分析」を押すと Director がワークフローを読みます" } } });
  assert.strictEqual(ja.trn(HINT), HINT_EN.replace("{name}", "Director"));
  // with or without copilot-ui.js, before or after a rename: always the role word
  const draft = "🪄 ให้ {name} ร่าง";
  assert.strictEqual(builderNames({ copilot: sc }).trn(draft), "🪄 ให้ Director ร่าง");
  assert.strictEqual(builderNames({ copilot: { roleName: () => "Director", directorName: () => "Kaito" } }).trn(draft), "🪄 ให้ Director ร่าง", "a renamed Director");
  assert.strictEqual(builderNames({ copilot: { directorName: () => "Kaito" } }).trn(draft), "🪄 ให้ Director ร่าง", "an older copilot-ui.js without roleName()");
  assert.strictEqual(builderNames({}).trn(draft), "🪄 ให้ Director ร่าง", "without copilot-ui.js");
  assert.strictEqual(builderNames({ lang: "en", copilot: sc }).trn(draft), "🪄 Let the Director draft");
});
