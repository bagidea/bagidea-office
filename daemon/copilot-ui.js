// daemon/copilot-ui.js — 🧠 who does the copilot work? (SPEC2 C6)
//
// Every copilot job in the office — ✨ persona copilot (Create / Edit Agent), 🪄 draft and
// 🔍 analyze in the Workflow Builder — is done by the office Director
// (reg.agents.main) with a brain (provider + model) the owner picks. This file is the one
// place that picks it: a small "🧠 Director ใช้ [Provider ▾] [Model ▾]" control that any page
// mounts, plus the helpers those pages share (settings cache, readable errors, result line,
// report to the dev team).
//
// Served by the daemon at GET /copilot-ui.js. Loaded by overlay.html (after its main script — the
// overlay's top-level tr / DICT / TR / LANG are visible here by name) and by workflow.html
// (its own tr / TR / LANG). Every use of a host helper is guarded, so the file also runs on
// its own (unit tests, a page without i18n): Thai source text + this file's curated en/zh/ja.
//
//   window.ShinoCopilot = {
//     mountPicker(el, { compact, inline, onChange }) → { destroy() }
//                                  compact = smaller, its status floats (never moves the page);
//                                  inline = one row that shrinks instead of wrapping (toolbars)
//     settings(force?)           → the GET /copilot/settings JSON (cached 10 s)
//     setBrain(provider, model)  → POST /copilot/settings   (provider "" = follow the Director)
//     onChange(fn)               → unsubscribe; fn(settings) on the first load, after a save from
//                                  any picker and when a refetch (window focus) differs
//     errorText(err)             → readable text (UI language) for the C5 error codes
//     helpers for the host pages: t(thai, vars) · roleName() · directorName() · brainText(brain) ·
//       request(url, body) → { ok, status, data, brain, error } · notice(el, opts) · relabel()
//   }
//
// Labels name the ROLE, never the person: every copilot label says "Director" (roleName()), because
// the owner can rename the Director and a label must not follow (or go stale with) the name.
// directorName() (settings().director.name) stays for callers that need the actual name.
// Every POST goes through request(), which always sends the owner-UI header x-bagidea-ui.
// All pickers share one settings snapshot: a save re-renders every picker on the page, and
// the snapshot is refetched when the window regains focus, so the overlay and the Workflow
// Builder window agree. Nothing here is secret: no keys are read, stored or logged.
(() => {
  "use strict";
  if (typeof window === "undefined" || window.ShinoCopilot) return;

  // ── i18n: curated en/zh/ja for every Thai string in this file, plus the copilot strings the
  // host pages render through ShinoCopilot.t(). "{name}" = the role word "Director" (roleName() —
  // never the Director's own name), "{brain}" = the provider / model that answered.
  /* scp-i18n:begin */
  const D = {
    "{name} ใช้": { en: "The {name} uses", zh: "{name} 使用", ja: "{name} の頭脳" },
    "สมองที่ Director ใช้ทำงาน copilot ทุกหน้า (ร่าง persona · ร่าง/วิเคราะห์ workflow) — เปลี่ยนที่นี่ = เปลี่ยนทุกหน้า": {
      en: "The brain the Director uses for every copilot job (persona drafts · workflow drafts/analysis) — change it here and it changes everywhere",
      zh: "Director 在所有 copilot 任务中使用的大脑（人设草稿 · 工作流起草/分析）— 在此更改即全部生效",
      ja: "Director がすべての copilot 作業（ペルソナ下書き · ワークフロー下書き/分析）に使う頭脳 — ここで変えると全ページに反映" },
    "ผู้ให้บริการ": { en: "Provider", zh: "提供商", ja: "プロバイダー" },
    "โมเดล": { en: "Model", zh: "模型", ja: "モデル" },
    "ตาม Director (ค่าเริ่มต้น)": { en: "Follow the Director (default)", zh: "跟随 Director（默认）", ja: "Director に合わせる（既定）" },
    "Local · ในเครื่อง": { en: "Local · on this machine", zh: "本地 · 本机", ja: "ローカル · このPC" },
    "● รันอยู่": { en: "● running", zh: "● 运行中", ja: "● 実行中" },
    "○ ไม่ได้รัน": { en: "○ not running", zh: "○ 未运行", ja: "○ 停止中" },
    "ยังไม่ได้เชื่อมต่อ": { en: "Not connected", zh: "未连接", ja: "未接続" },
    "ไม่อยู่ในรายการ": { en: "not in the list", zh: "不在列表中", ja: "一覧にありません" },
    "ดีฟอลต์ของผู้ให้บริการ": { en: "Provider default", zh: "提供商默认", ja: "プロバイダーの既定" },
    "ใช้โมเดลเดียวกับ Director — เลือกผู้ให้บริการก่อนถ้าจะเปลี่ยน": {
      en: "Same model as the Director — pick a provider first to change it",
      zh: "与 Director 使用相同的模型 — 如需更改请先选择提供商",
      ja: "Director と同じモデル — 変更するには先にプロバイダーを選んでください" },
    "พิมพ์ชื่อโมเดลเองได้": { en: "Type a model name", zh: "可自行输入模型名", ja: "モデル名を入力" },
    "ไม่พบโมเดลที่ตรง — กด Enter เพื่อใช้ชื่อนี้": { en: "No match — press Enter to use this id", zh: "没有匹配的模型 — 按 Enter 使用此名称", ja: "一致するモデルなし — Enter でこの ID を使用" },
    "⏳ กำลังโหลด…": { en: "⏳ Loading…", zh: "⏳ 正在加载…", ja: "⏳ 読み込み中…" },
    "กำลังบันทึก…": { en: "Saving…", zh: "正在保存…", ja: "保存中…" },
    "บันทึกแล้ว": { en: "Saved", zh: "已保存", ja: "保存しました" },
    "บันทึกไม่สำเร็จ": { en: "Save failed", zh: "保存失败", ja: "保存に失敗しました" },
    "อ่านการตั้งค่าสมองไม่ได้": { en: "Couldn't load the brain settings", zh: "无法读取大脑设置", ja: "頭脳の設定を読み込めません" },
    "ลองใหม่": { en: "Retry", zh: "重试", ja: "再試行" },
    "ชื่อโมเดลยาวเกิน 160 ตัวอักษร": { en: "The model id is longer than 160 characters", zh: "模型名称超过 160 个字符", ja: "モデル ID が 160 文字を超えています" },
    "ชื่อโมเดลมีตัวอักษรที่ใช้ไม่ได้ (ใช้ได้: ตัวอักษร ตัวเลข . _ - / : @ + ~ [ ])": {
      en: "The model id has characters that aren't allowed (allowed: letters, digits . _ - / : @ + ~ [ ])",
      zh: "模型名称包含不允许的字符（允许：字母、数字 . _ - / : @ + ~ [ ]）",
      ja: "モデル ID に使えない文字があります（使用可：英数字 . _ - / : @ + ~ [ ]）" },
    // C5 error codes → what the owner can do about it
    "ยังไม่ได้เชื่อมต่อผู้ให้บริการนี้ — เชื่อมต่อที่ ⚙ CONNECT หรือเลือกสมองอื่น": {
      en: "This provider isn't connected yet — connect it in ⚙ CONNECT or pick another brain",
      zh: "尚未连接此提供商 — 请在 ⚙ CONNECT 中连接，或选择其他大脑",
      ja: "このプロバイダーは未接続です — ⚙ CONNECT で接続するか、別の頭脳を選んでください" },
    "ผู้ให้บริการไม่ยอมรับคีย์หรือสิทธิ์ (401/403) — ตรวจคีย์ที่ ⚙ CONNECT": {
      en: "The provider rejected the key or permission (401/403) — check the key in ⚙ CONNECT",
      zh: "提供商拒绝了密钥或权限（401/403）— 请在 ⚙ CONNECT 检查密钥",
      ja: "プロバイダーがキーまたは権限を拒否しました（401/403）— ⚙ CONNECT でキーを確認してください" },
    "ผู้ให้บริการไม่รู้จักโมเดลนี้ — เลือกโมเดลอื่นในช่องโมเดล": {
      en: "The provider doesn't know this model — pick another one in the model box",
      zh: "提供商不认识这个模型 — 请在模型栏中选择其他模型",
      ja: "プロバイダーがこのモデルを認識しません — モデル欄で別のモデルを選んでください" },
    "รอคำตอบนานเกินไป — ลองใหม่ หรือเลือกโมเดลที่เร็วกว่า": {
      en: "The answer took too long — try again or pick a faster model",
      zh: "等待回复超时 — 请重试或选择更快的模型",
      ja: "応答に時間がかかりすぎました — 再試行するか、より速いモデルを選んでください" },
    "ติดต่อผู้ให้บริการไม่ได้ — ตรวจอินเทอร์เน็ต หรือเปิด server ในเครื่องให้รันอยู่": {
      en: "Couldn't reach the provider — check the internet, or start the local server",
      zh: "无法连接提供商 — 请检查网络，或启动本地服务器",
      ja: "プロバイダーに接続できません — ネット接続を確認するか、ローカルサーバーを起動してください" },
    "โมเดลตอบกลับมาว่างเปล่า — ลองใหม่ หรือเลือกโมเดลอื่น": {
      en: "The model sent back an empty answer — try again or pick another model",
      zh: "模型返回了空回复 — 请重试或选择其他模型",
      ja: "モデルの応答が空でした — 再試行するか、別のモデルを選んでください" },
    "โมเดลตอบกลับมาในรูปแบบที่ระบบอ่านไม่ได้ — ลองใหม่ หรือเลือกโมเดลที่เก่งกว่า": {
      en: "The model's answer wasn't in a format the office can read — try again or pick a stronger model",
      zh: "模型回复的格式无法读取 — 请重试或选择更强的模型",
      ja: "モデルの応答を読み取れない形式でした — 再試行するか、より高性能なモデルを選んでください" },
    "ผู้ให้บริการตอบกลับด้วยข้อผิดพลาด — ลองใหม่อีกครั้ง": {
      en: "The provider answered with an error — try again",
      zh: "提供商返回了错误 — 请重试",
      ja: "プロバイダーがエラーを返しました — もう一度お試しください" },
    "ติดต่อออฟฟิศไม่ได้ — ตรวจว่าออฟฟิศยังเปิดอยู่ แล้วลองใหม่": {
      en: "Couldn't reach the office — check that it is still running, then try again",
      zh: "无法连接办公室 — 请确认它仍在运行，然后重试",
      ja: "オフィスに接続できません — 起動中か確認してから再試行してください" },
    "ออฟฟิศตอบกลับด้วยข้อผิดพลาด": { en: "The office answered with an error", zh: "办公室返回了错误", ja: "オフィスがエラーを返しました" },
    "ออฟฟิศตอบกลับมาในรูปแบบที่อ่านไม่ได้": { en: "The office sent back something unreadable", zh: "办公室返回的内容无法读取", ja: "オフィスから読み取れない応答が返りました" },
    "ชื่อโมเดลไม่ถูกต้อง": { en: "Invalid model id", zh: "模型名称无效", ja: "無効なモデル ID" },
    "ทำไม่สำเร็จ — ลองใหม่อีกครั้ง": { en: "It didn't work — try again", zh: "未能完成 — 请重试", ja: "うまくいきませんでした — もう一度お試しください" },
    // result line + report
    "{name} ใช้ {brain}": { en: "The {name} used {brain}", zh: "{name} 使用了 {brain}", ja: "{name} が使った頭脳：{brain}" },
    "ร่างโดย {brain}": { en: "Drafted by {brain}", zh: "起草：{brain}", ja: "下書き：{brain}" },
    "วิเคราะห์โดย {brain}": { en: "Analyzed by {brain}", zh: "分析：{brain}", ja: "分析：{brain}" },
    "แจ้งทีมพัฒนา": { en: "Report to the dev team", zh: "报告给开发团队", ja: "開発チームに報告" },
    // host pages (overlay ✨ persona copilot · Workflow Builder)
    "✨ ให้ {name} ร่าง persona": { en: "✨ Let the {name} draft the persona", zh: "✨ 让 {name} 起草人设", ja: "✨ {name} にペルソナを下書きしてもらう" },
    "{name} กำลังร่าง…": { en: "The {name} is drafting…", zh: "{name} 正在起草…", ja: "{name} が下書き中…" },
    "ร่าง persona": { en: "Draft the persona", zh: "起草人设", ja: "ペルソナの下書き" },
    "ร่าง persona ไม่สำเร็จ": { en: "Persona draft failed", zh: "人设起草失败", ja: "ペルソナの下書きに失敗しました" },
    "ร่างไม่สำเร็จ": { en: "Draft failed", zh: "起草失败", ja: "下書きに失敗しました" },
    "วิเคราะห์ไม่สำเร็จ": { en: "Analysis failed", zh: "分析失败", ja: "分析に失敗しました" },
  };
  /* scp-i18n:end */
  // Merge into the overlay's DICT / TR, so its tr() and DOM auto-translate know these too
  // (never overriding one of the overlay's own curated entries). Other hosts: T() reads D.
  try {
    for (const [k, v] of Object.entries(D)) {
      if (!DICT[k]) DICT[k] = v;
      if (LANG !== "th" && DICT[k][LANG]) TR[k] = DICT[k][LANG];
    }
  } catch { /* not the overlay (Workflow Builder, tests) */ }

  // ── small helpers ──────────────────────────────────────────────────────────────
  const own = (o, k) => !!o && typeof o === "object" && Object.prototype.hasOwnProperty.call(o, k);
  const E = (x) => String(x === undefined || x === null ? "" : x)
    .replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const clip = (s, n) => {
    const t = String(s === undefined || s === null ? "" : s).replace(/\s+/g, " ").trim();
    return t.length > n ? t.slice(0, n - 1) + "…" : t;
  };
  const stripTags = (s) => String(s || "").replace(/<[^>]*>/g, " ");
  const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (own(vars, k) && vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : m));
  // A host callback that throws must not break the others; rethrow outside so it still shows.
  const safely = (fn, arg) => { try { fn(arg); } catch (e) { setTimeout(() => { throw e; }, 0); } };

  // The UI language: the host's LANG (overlay · Workflow Builder), else <html lang>, else Thai.
  function lang() {
    try { if (typeof LANG === "string" && LANG) return LANG; } catch { /* not declared yet */ }
    try { const l = document.documentElement.getAttribute("lang"); if (l) return l.slice(0, 2).toLowerCase(); } catch { /* no DOM */ }
    return "th";
  }
  // Thai source → UI language: this file's curated entry, else the host's tr(), else English.
  function T(s, vars) {
    const src = String(s === undefined || s === null ? "" : s);
    let out = src;
    const L = lang();
    if (L !== "th") {
      const d = own(D, src) ? D[src] : null;
      let host = "";
      try { if (typeof tr === "function") { const v = tr(src); if (typeof v === "string" && v && v !== src) host = v; } } catch { /* no host tr */ }
      out = (d && d[L]) || host || (d && d.en) || src;
    }
    return vars ? fill(out, vars) : out;
  }

  // ── contract constants ─────────────────────────────────────────────────────────
  const TTL = 10000;                                  // settings() cache
  const MODEL_MAX = 160;                              // same rule as fallback.js cleanFallbackModel
  const MODEL_RE = /^[\w.\-/:@+~[\]]*$/;
  const HDR = { "content-type": "application/json", "x-bagidea-ui": "1" };
  const GROUPS = [["claude", "Claude"], ["local", "Local · ในเครื่อง"], ["cloud", "Cloud"], ["custom", "Custom"]];
  // Non-chat ids a provider lists (vision projectors, embeddings, TTS…) stay out of the model
  // list unless nothing else is left — the same filter as the Edit Agent picker (+ mmproj).
  const NONCHAT = /(mmproj|image|tts|audio|speech|whisper|transcri|embedding|\bembed\b|moderation|rerank|guard|safety|dall|imagen|veo|sora|-live\b|realtime|\bclip\b|bison|gecko)/i;
  const ERR = {
    NOT_CONNECTED: "ยังไม่ได้เชื่อมต่อผู้ให้บริการนี้ — เชื่อมต่อที่ ⚙ CONNECT หรือเลือกสมองอื่น",
    AUTH: "ผู้ให้บริการไม่ยอมรับคีย์หรือสิทธิ์ (401/403) — ตรวจคีย์ที่ ⚙ CONNECT",
    MODEL_NOT_FOUND: "ผู้ให้บริการไม่รู้จักโมเดลนี้ — เลือกโมเดลอื่นในช่องโมเดล",
    TIMEOUT: "รอคำตอบนานเกินไป — ลองใหม่ หรือเลือกโมเดลที่เร็วกว่า",
    NETWORK: "ติดต่อผู้ให้บริการไม่ได้ — ตรวจอินเทอร์เน็ต หรือเปิด server ในเครื่องให้รันอยู่",
    EMPTY: "โมเดลตอบกลับมาว่างเปล่า — ลองใหม่ หรือเลือกโมเดลอื่น",
    BAD_JSON: "โมเดลตอบกลับมาในรูปแบบที่ระบบอ่านไม่ได้ — ลองใหม่ หรือเลือกโมเดลที่เก่งกว่า",
    UPSTREAM: "ผู้ให้บริการตอบกลับด้วยข้อผิดพลาด — ลองใหม่อีกครั้ง",
    OFFLINE: "ติดต่อออฟฟิศไม่ได้ — ตรวจว่าออฟฟิศยังเปิดอยู่ แล้วลองใหม่",
    HTTP: "ออฟฟิศตอบกลับด้วยข้อผิดพลาด",
    BAD_RESPONSE: "ออฟฟิศตอบกลับมาในรูปแบบที่อ่านไม่ได้",
    BAD_MODEL: "ชื่อโมเดลไม่ถูกต้อง",
    FAILED: "ทำไม่สำเร็จ — ลองใหม่อีกครั้ง",
  };

  // ── errors ─────────────────────────────────────────────────────────────────────
  // Anything a copilot call can fail with → { code, message, status }: a C5 error object, a whole
  // 502 body ({ ok:false, error, brain }), an Error (fetch's TypeError = the office is offline),
  // a bare code ("AUTH") or plain text.
  function normErr(x) {
    if (x === undefined || x === null || x === false) return { code: "FAILED", message: "", status: 0 };
    if (typeof x === "string") return /^[A-Z][A-Z_]{2,31}$/.test(x) ? { code: x, message: "", status: 0 } : { code: "FAILED", message: x, status: 0 };
    if (typeof x !== "object") return { code: "FAILED", message: String(x), status: 0 };
    if (!x.code && x.error && (typeof x.error === "object" || typeof x.error === "string")) {
      const e = normErr(x.error);
      if (!e.status && Number(x.status)) e.status = Number(x.status);
      return e;
    }
    const status = Number(x.status) || 0;
    const code = typeof x.code === "string" && x.code ? x.code.toUpperCase()
      : x.name === "TypeError" ? "OFFLINE" : status ? "HTTP" : "FAILED";
    return { code, message: typeof x.message === "string" ? x.message : "", status };
  }
  // Readable text (UI language): what went wrong + what to do, then the raw detail on line 2.
  function errorText(x) {
    const e = normErr(x);
    let head = own(ERR, e.code) ? T(ERR[e.code]) : T(ERR.FAILED) + " (" + e.code + ")";
    if (e.status && (e.code === "HTTP" || e.code === "BAD_RESPONSE")) head += " (HTTP " + e.status + ")";
    const detail = clip(stripTags(e.message), 300);
    return detail && detail !== head ? head + "\n" + detail : head;
  }
  // One line for a bug report: code · HTTP status · raw message.
  function errorRaw(x) {
    const e = normErr(x);
    return [e.code, e.status ? "HTTP " + e.status : "", clip(e.message, 1200)].filter(Boolean).join(" · ");
  }
  const mkErr = (code, message, status) => Object.assign(new Error(message || code), { code, status: status || 0 });

  // ── HTTP ───────────────────────────────────────────────────────────────────────
  // POST a copilot job → { ok, status, data, brain, error }. Never throws: an offline office,
  // a 502 JSON error (C5), a text 500 and a 200 { ok:false } all come back as { ok:false, error }.
  async function request(url, body) {
    let r;
    try {
      r = await window.fetch(url, { method: "POST", headers: { ...HDR }, body: JSON.stringify(body === undefined || body === null ? {} : body) });
    } catch (e) {
      return { ok: false, status: 0, data: null, brain: null, error: { code: "OFFLINE", message: clip((e && e.message) || e, 300), status: 0 } };
    }
    const text = await r.text().catch(() => "");
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch { j = null; }
    const obj = j && typeof j === "object" && !Array.isArray(j) ? j : null;
    const brain = obj && obj.brain && typeof obj.brain === "object" ? obj.brain : null;
    if (r.ok && obj && obj.ok !== false) return { ok: true, status: r.status, data: obj, brain, error: null };
    const e = obj ? obj.error : null;
    const error = e && typeof e === "object"
      ? { code: String(e.code || "UPSTREAM").toUpperCase(), message: String(e.message || ""), status: r.status }
      : { code: r.ok ? (obj ? "FAILED" : "BAD_RESPONSE") : "HTTP",
          message: typeof e === "string" ? e : obj ? "" : clip(stripTags(text), 400), status: r.status };
    return { ok: false, status: r.status, data: obj, brain, error };
  }

  // ── settings snapshot (shared by every picker on the page) ─────────────────────
  const S = { data: null, at: 0, err: null, sig: "", ver: 0, inflight: null, inflightVer: -1, seq: 0 };
  const pickers = new Set(), subs = new Set();

  function norm(j) {
    const d = { ...j };
    d.provider = typeof j.provider === "string" && j.provider !== "director" ? j.provider : "";
    d.model = d.provider && typeof j.model === "string" ? j.model : "";
    d.effective = j.effective && typeof j.effective === "object" ? j.effective : {};
    d.director = j.director && typeof j.director === "object" ? j.director : {};
    d.providers = (Array.isArray(j.providers) ? j.providers : [])
      .filter((p) => p && typeof p === "object" && typeof p.id === "string" && p.id)
      .map((p) => ({ ...p, label: String(p.label || p.id),
        group: GROUPS.some(([g]) => g === p.group) ? p.group : p.id === "claude" ? "claude" : "cloud",
        connected: !!p.connected, running: typeof p.running === "boolean" ? p.running : null,
        models: Array.isArray(p.models) ? p.models.map((m) => String(m === undefined || m === null ? "" : m)) : [] }));
    return d;
  }
  function sigOf(d) {
    try { return JSON.stringify([d.provider, d.model, d.effective, d.director, d.providers]); } catch { return String(Date.now()); }
  }
  function accept(j) {
    const d = norm(j);
    S.data = d; S.at = Date.now(); S.err = null;
    const sig = sigOf(d);
    if (sig !== S.sig) { S.sig = sig; emit(); }
    return d;
  }
  function settings(force) {
    if (!force && S.data && Date.now() - S.at < TTL) return Promise.resolve(S.data);
    if (S.inflight && (!force || S.inflightVer === S.ver)) return S.inflight;
    const ver = S.ver;
    const p = (async () => {
      let r, text = "", j = null;
      try {
        r = await window.fetch("/copilot/settings", { cache: "no-store" });
        text = await r.text().catch(() => "");
      } catch (e) { throw mkErr("OFFLINE", clip((e && e.message) || e, 300)); }
      try { j = text ? JSON.parse(text) : null; } catch { j = null; }
      if (!r.ok || !j || typeof j !== "object" || Array.isArray(j)) {
        const e = j && typeof j === "object" ? normErr(j) : null;
        throw mkErr(e && e.code !== "FAILED" ? e.code : r.ok ? "BAD_RESPONSE" : "HTTP", (e && e.message) || clip(stripTags(text), 300), r.status);
      }
      if (ver !== S.ver && S.data) return S.data;     // a save landed meanwhile — its snapshot wins
      return accept(j);
    })().catch((err) => {
      S.err = err;
      if (S.data) return S.data;                        // keep showing the last good snapshot
      paint();                                          // pickers show the error + ↻
      throw err;
    });
    S.inflight = p; S.inflightVer = ver;
    const done = () => { if (S.inflight === p) S.inflight = null; };
    p.then(done, done);
    return p;
  }
  function modelProblem(m) {
    if (m.length > MODEL_MAX) return "ชื่อโมเดลยาวเกิน 160 ตัวอักษร";
    if (!MODEL_RE.test(m)) return "ชื่อโมเดลมีตัวอักษรที่ใช้ไม่ได้ (ใช้ได้: ตัวอักษร ตัวเลข . _ - / : @ + ~ [ ])";
    return "";
  }
  function provLabel(id) {
    const p = S.data && S.data.providers.find((x) => x.id === id);
    return p ? p.label : String(id || "");
  }
  function guessEffective(d) {
    const dir = d.director || {};
    return d.provider
      ? { provider: d.provider, model: d.model, label: provLabel(d.provider), source: "copilot" }
      : { provider: dir.provider || "", model: dir.model || "", label: provLabel(dir.provider || ""), source: "director" };
  }
  // Save the copilot brain. provider "" (or "director") = follow the Director's own brain.
  async function setBrain(provider, model) {
    let p = String(provider === undefined || provider === null ? "" : provider).trim();
    if (p === "director") p = "";
    const m = p ? String(model === undefined || model === null ? "" : model).trim() : "";
    const bad = modelProblem(m);
    if (bad) throw mkErr("BAD_MODEL", T(bad));
    const seq = ++S.seq;
    const r = await request("/copilot/settings", { provider: p, model: m });
    if (!r.ok) throw mkErr(r.error.code, r.error.message, r.error.status);
    if (seq === S.seq) {                                // a later save from another picker wins
      const had = !!S.data;
      S.ver++;
      const base = had ? { ...S.data } : { director: {}, providers: [] };
      base.provider = p; base.model = m;
      const eff = r.data && r.data.effective && typeof r.data.effective === "object" ? r.data.effective : null;
      base.effective = eff || guessEffective(base);
      accept(base);
      if (!had || !eff) settings(true).catch(() => {});
    }
    return r.data;
  }
  function onChange(fn) {
    if (typeof fn !== "function") return () => {};
    subs.add(fn);
    return () => { subs.delete(fn); };
  }
  // The word every copilot label shows: the ROLE (the owner's request, 2026-09-29 — the Director
  // can be renamed, and a label carrying the old name read wrong). Not translated: "Director" is
  // the office's word for this role in every language (the picker's "follow the Director" option too).
  const ROLE = "Director";
  function roleName() { return ROLE; }
  // The Director's actual name (settings().director.name) — for callers that need the person, not labels.
  function directorName() {
    const d = S.data || {};
    const n = (d.director && typeof d.director.name === "string" && d.director.name.trim()) ||
      (d.effective && typeof d.effective.directorName === "string" && d.effective.directorName.trim());
    return n || "Director";
  }
  // "<provider> / <model>" for the brain that answered (C5 run().brain).
  function brainText(b) {
    if (!b || typeof b !== "object") return "";
    const model = String(b.model || ""), label = String(b.label || "");
    if (label && (!model || label.includes(model))) return label;
    return [label || provLabel(b.provider), model].filter(Boolean).join(" / ");
  }

  // ── the picker ─────────────────────────────────────────────────────────────────
  function emit() {
    for (const P of [...pickers]) {
      if (gone(P)) { drop(P); continue; }
      render(P);
      if (P.onChange) safely(P.onChange, S.data);
    }
    for (const fn of [...subs]) safely(fn, S.data);
  }
  function paint() { for (const P of [...pickers]) { if (gone(P)) drop(P); else render(P); } }
  // A picker whose element left the document (the panel re-rendered, ‹ › switched agents) is
  // dropped on the next update — no destroy() call needed from the host.
  function gone(P) { if (P.el.isConnected) { P.seen = true; return false; } return P.seen; }
  function drop(P) { pickers.delete(P); clearTimeout(P.okT); clearTimeout(P.errT); }
  function prune() { for (const P of [...pickers]) if (gone(P)) drop(P); }
  const focused = (el) => !!el && el.ownerDocument && el.ownerDocument.activeElement === el;

  function modelsFor(d, pid) {
    const p = d.providers.find((x) => x.id === pid);
    const all = [...new Set((p ? p.models : []).map((m) => m.replace(/^models\//, "").trim()).filter(Boolean))];
    const chat = all.filter((m) => !NONCHAT.test(m));
    return chat.length ? chat : all;
  }
  // "ตาม Director (ค่าเริ่มต้น)" first, then Claude · Local (● / ○) · Cloud (✅) · Custom (✅).
  // A cloud/custom provider that is not connected is listed but cannot be picked.
  function providerOptions(d) {
    const dir = d.director || {}, eff = d.effective || {};
    const dp = dir.provider || (!d.provider && eff.provider) || "";
    let h = `<option value="">${E(T("ตาม Director (ค่าเริ่มต้น)") + (dp ? " · " + provLabel(dp) : ""))}</option>`;
    if (d.provider && !d.providers.some((p) => p.id === d.provider))
      h += `<option value="${E(d.provider)}">${E("⚠ " + d.provider + " · " + T("ไม่อยู่ในรายการ"))}</option>`;
    for (const [g, label] of GROUPS) {
      const list = d.providers.filter((p) => p.group === g);
      if (!list.length) continue;
      const usable = (p) => g === "local" || g === "claude" || p.connected;
      h += `<optgroup label="${E(T(label))}">` + list.filter(usable).concat(list.filter((p) => !usable(p))).map((p) => {
        let text = p.label;
        if (g === "local") {
          if (p.running === true) text += " · " + T("● รันอยู่");
          else if (p.running === false) text += " · " + T("○ ไม่ได้รัน");
        } else if (p.connected) text = "✅ " + text;
        const off = !usable(p);
        if (off) text += " · " + T("ยังไม่ได้เชื่อมต่อ");
        return `<option value="${E(p.id)}"${off && p.id !== d.provider ? " disabled" : ""}>${E(text)}</option>`;
      }).join("") + "</optgroup>";
    }
    return h;
  }
  function render(P) {
    if (P.el.isConnected) P.seen = true;
    const d = S.data, name = roleName();
    const lead = T("{name} ใช้").split("{name}");
    P.l1.textContent = lead[0] || "";
    P.nameEl.textContent = name;
    P.l2.textContent = lead.slice(1).join(name);
    P.lead.title = T("สมองที่ Director ใช้ทำงาน copilot ทุกหน้า (ร่าง persona · ร่าง/วิเคราะห์ workflow) — เปลี่ยนที่นี่ = เปลี่ยนทุกหน้า");
    P.prov.setAttribute("aria-label", T("ผู้ให้บริการ"));
    P.model.setAttribute("aria-label", T("โมเดล"));
    if (!d) {
      setOptions(P, `<option value="">${E(S.err ? "⚠" : T("⏳ กำลังโหลด…"))}</option>`);
      P.prov.disabled = true; P.model.disabled = true; P.model.value = ""; P.model.placeholder = ""; P.model.title = "";
      closeMenu(P);
      if (S.err) setState(P, "err", "⚠ " + T("อ่านการตั้งค่าสมองไม่ได้") + " — " + errorText(S.err), "load");
      return;
    }
    if (P.stateFrom === "load") setState(P, null);
    setOptions(P, providerOptions(d));
    P.prov.value = d.provider;
    const follow = !d.provider, eff = d.effective || {}, dir = d.director || {};
    P.prov.disabled = P.busy;
    P.model.disabled = P.busy || follow;
    if (!(P.typing && focused(P.model))) { P.typing = false; P.model.value = follow ? String(eff.model || dir.model || "") : d.model; }
    P.model.placeholder = follow ? "" : eff.provider === d.provider && eff.model && !d.model ? String(eff.model) : T("ดีฟอลต์ของผู้ให้บริการ");
    P.model.title = follow ? T("ใช้โมเดลเดียวกับ Director — เลือกผู้ให้บริการก่อนถ้าจะเปลี่ยน") : "";
    if (P.menuOpen) { if (P.model.disabled) closeMenu(P); else renderMenu(P); }
  }
  function setOptions(P, html) { if (P.optHtml !== html) { P.prov.innerHTML = html; P.optHtml = html; } }
  function setState(P, kind, text, from) {
    P.stateKind = kind || null;
    P.stateFrom = kind ? from || "" : "";
    P.state.className = "scp-state" + (kind ? " scp-" + kind : "");
    P.state.textContent = kind ? text : "";
    clearTimeout(P.errT);
    // a compact picker's status floats over the page: a click dismisses it, an error fades in 12 s
    P.state.onclick = P.compact && kind && kind !== "busy" ? (e) => { if (!e.target.closest(".scp-retry")) setState(P, null); } : null;
    if (P.compact && kind === "err" && from !== "load") P.errT = setTimeout(() => { if (P.stateKind === "err") setState(P, null); }, 12000);
    if (kind === "err" && from === "load") {
      const b = P.state.ownerDocument.createElement("button");
      b.type = "button"; b.className = "scp-retry"; b.textContent = "↻ " + T("ลองใหม่");
      b.onclick = () => { setState(P, "busy", T("⏳ กำลังโหลด…"), "load"); settings(true).catch(() => {}); };
      P.state.appendChild(b);
    }
  }

  // Model combobox: focus shows the provider's whole list, typing filters it, ↑/↓ + Enter or a
  // click picks, Enter / leaving the box saves a typed id (max 160). Esc folds the list first.
  function renderMenu(P) {
    const d = S.data;
    if (!d || !d.provider || P.model.disabled) { closeMenu(P); return; }
    const q = P.typing ? P.model.value.trim().toLowerCase() : "";
    P.list = modelsFor(d, d.provider).filter((m) => !q || m.toLowerCase().includes(q)).slice(0, 300);
    if (P.hi >= P.list.length) P.hi = P.list.length - 1;
    P.menu.innerHTML = P.list.length
      ? P.list.map((m, i) => `<div class="scp-opt${i === P.hi ? " scp-hi" : ""}${m === d.model ? " scp-cur" : ""}" role="option" data-i="${i}"` +
          ` aria-selected="${i === P.hi}" title="${E(m)}">${E(m)}</div>`).join("")
      : `<div class="scp-opt scp-none">${E(T(q ? "ไม่พบโมเดลที่ตรง — กด Enter เพื่อใช้ชื่อนี้" : "พิมพ์ชื่อโมเดลเองได้"))}</div>`;
    P.menu.hidden = false; P.menuOpen = true;
    P.model.setAttribute("aria-expanded", "true");
    const hi = P.menu.querySelector(".scp-hi");
    if (hi && hi.scrollIntoView) try { hi.scrollIntoView({ block: "nearest" }); } catch { /* old engines */ }
  }
  function closeMenu(P) {
    P.menu.hidden = true; P.menuOpen = false; P.hi = -1;
    P.model.setAttribute("aria-expanded", "false");
  }
  function pick(P, m) {
    if (m === undefined || m === null) return;
    P.model.value = m; P.typing = false;
    commit(P, m);
  }
  function commit(P, raw) {
    closeMenu(P);
    const d = S.data;
    if (!d || !d.provider) return;
    const m = String(raw === undefined || raw === null ? "" : raw).trim();
    if (m === d.model || (P.busy && m === P.sent)) { P.typing = false; if (!P.busy) render(P); return; }
    const bad = modelProblem(m);
    if (bad) { setState(P, "err", "⚠ " + T(bad), "save"); return; }
    P.typing = false;
    save(P, d.provider, m);
  }
  function onProvider(P) {
    const d = S.data;
    if (!d) return;
    const p = P.prov.value;
    let m = "";
    if (p) {   // keep the model when the new provider lists it, else its first chat model
      const list = modelsFor(d, p);
      const cur = String((d.provider ? d.model : (d.effective || {}).model) || "");
      m = cur && list.includes(cur) ? cur : list[0] || "";
    }
    P.typing = false; closeMenu(P);
    save(P, p, m);
  }
  async function save(P, p, m) {
    const my = ++P.saveSeq;
    P.busy = true; P.sent = m;
    P.prov.disabled = true; P.model.disabled = true;
    setState(P, "busy", "⏳ " + T("กำลังบันทึก…"), "save");
    let err = null;
    try { await setBrain(p, m); } catch (e) { err = e; }
    if (my !== P.saveSeq) return;
    P.busy = false; P.sent = null;
    render(P);                                          // the saved snapshot (reverts a failed pick)
    clearTimeout(P.okT);
    if (err) { setState(P, "err", "⚠ " + T("บันทึกไม่สำเร็จ") + " — " + errorText(err), "save"); return; }
    setState(P, "ok", "✓ " + T("บันทึกแล้ว"), "save");
    P.okT = setTimeout(() => { if (P.stateKind === "ok") setState(P, null); }, 2500);
  }
  function onKey(P, e) {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!P.menuOpen) renderMenu(P);
      const n = P.list.length;
      if (!n) return;
      P.hi = e.key === "ArrowDown" ? (P.hi + 1) % n : P.hi <= 0 ? n - 1 : P.hi - 1;
      renderMenu(P);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (P.menuOpen && P.hi >= 0 && P.list[P.hi] !== undefined) pick(P, P.list[P.hi]);
      else commit(P, P.model.value);
    } else if (e.key === "Escape" && (P.menuOpen || P.typing)) {
      // the first Esc folds the list, the next drops the typed text — never the whole panel
      e.preventDefault(); e.stopPropagation();
      if (P.menuOpen) closeMenu(P);
      else { P.typing = false; render(P); }
    }
  }
  function wire(P) {
    P.prov.addEventListener("change", () => onProvider(P));
    P.model.addEventListener("focus", () => { P.typing = false; P.hi = -1; renderMenu(P); });
    P.model.addEventListener("input", () => { P.typing = true; P.hi = -1; renderMenu(P); });
    P.model.addEventListener("blur", () => { setTimeout(() => { if (!focused(P.model)) closeMenu(P); }, 150); });
    P.model.addEventListener("change", () => commit(P, P.model.value));
    P.model.addEventListener("keydown", (e) => onKey(P, e));
    P.menu.addEventListener("mousedown", (e) => {
      e.preventDefault();                               // keep the focus in the box
      const o = e.target && e.target.closest ? e.target.closest(".scp-opt[data-i]") : null;
      if (o) pick(P, P.list[Number(o.dataset.i)]);
    });
  }
  // "🧠 <Director> ใช้ [Provider ▾] [Model ▾]" into `el` (its content is replaced).
  function mountPicker(el, opts) {
    if (!el || !el.ownerDocument) return { destroy() {} };
    const o = opts || {};
    css();
    prune();
    for (const Q of [...pickers]) if (Q.el === el) drop(Q);
    el.innerHTML = `<div class="scp${o.compact ? " scp-compact" : ""}${o.inline ? " scp-inline" : ""}" data-scp="1">` +
      `<span class="scp-lead">🧠 <span class="scp-l1"></span><b class="scp-name"></b><span class="scp-l2"></span></span>` +
      `<select class="scp-prov"></select>` +
      `<div class="scp-mwrap"><input class="scp-model" type="text" maxlength="${MODEL_MAX}" autocomplete="off" spellcheck="false"` +
      ` role="combobox" aria-autocomplete="list" aria-expanded="false"><div class="scp-menu" role="listbox" hidden></div></div>` +
      `<div class="scp-state" role="status" aria-live="polite"></div></div>`;
    const root = el.firstElementChild, q = (s) => root.querySelector(s);
    const P = { el, root, compact: !!o.compact, onChange: typeof o.onChange === "function" ? o.onChange : null,
      lead: q(".scp-lead"), l1: q(".scp-l1"), nameEl: q(".scp-name"), l2: q(".scp-l2"), prov: q(".scp-prov"),
      model: q(".scp-model"), menu: q(".scp-menu"), state: q(".scp-state"),
      list: [], hi: -1, typing: false, menuOpen: false, busy: false, sent: null, saveSeq: 0, seen: false, optHtml: "",
      stateKind: null, stateFrom: "", okT: 0, errT: 0 };
    wire(P);
    pickers.add(P);
    render(P);
    settings().catch(() => {});                         // cached for 10 s; a stale snapshot refetches
    return { destroy() { drop(P); if (root.parentNode) root.remove(); } };
  }
  // Re-render every picker in the current UI language (the Workflow Builder switches LANG late).
  function relabel() { for (const P of pickers) P.optHtml = ""; paint(); }

  // ── the result line under a copilot button ─────────────────────────────────────
  //   notice(el, null)                                   → hidden
  //   notice(el, { brain, done: "ร่างโดย {brain}" })     → "🧠 ร่างโดย Claude / claude-…"
  //   notice(el, { error, brain, title?, report?: { source, step, context? } })
  //       → "⚠ <title> — <errorText>" + the brain that was asked + 🐞 แจ้งทีมพัฒนา (C2) when
  //         the page has window.bagReport.
  function notice(el, o) {
    if (!el || !el.ownerDocument) return;
    css();
    const doc = el.ownerDocument;
    el.classList.add("scp-msg");
    el.classList.remove("scp-ok", "scp-err");
    el.textContent = "";
    if (!o) { el.hidden = true; return; }
    const line = (text, cls) => { const d = doc.createElement("div"); if (cls) d.className = cls; d.textContent = text; el.appendChild(d); };
    const b = brainText(o.brain);
    if (o.error) {
      el.classList.add("scp-err");
      line("⚠ " + (o.title ? T(o.title) + " — " : "") + errorText(o.error));
      if (b) line("🧠 " + T("{name} ใช้ {brain}", { name: roleName(), brain: b }), "scp-sub");
      if (o.report && window.bagReport && typeof window.bagReport.open === "function") {
        const rb = doc.createElement("button");
        rb.type = "button"; rb.className = "scp-rep"; rb.textContent = "🐞 " + T("แจ้งทีมพัฒนา");
        rb.onclick = () => openReport(o.report, o.error, o.brain);
        el.appendChild(rb);
      }
    } else {
      if (!b) { el.hidden = true; return; }
      el.classList.add("scp-ok");
      line("🧠 " + T(o.done || "ร่างโดย {brain}", { brain: b, name: roleName() }));
    }
    el.hidden = false;
  }
  function openReport(rep, err, brain) {
    const eff = (S.data && S.data.effective) || {}, b = brain && typeof brain === "object" ? brain : {};
    safely((payload) => window.bagReport.open(payload), {
      source: String(rep.source || "copilot"), step: String(rep.step || ""), error: errorRaw(err),
      context: { provider: String(b.provider || eff.provider || ""), model: String(b.model || eff.model || ""), ...(rep.context || {}) },
    });
  }

  // ── styles (own prefix; the #modalCard variants beat the overlay's `#modalCard select`) ──
  const CSS = `
.scp{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;margin:0 0 7px;font-size:12px;line-height:1.35;color:var(--text,#dce6f2)}
.scp .scp-lead{flex:none;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dim,#8294ab)}
.scp .scp-name{color:var(--text,#dce6f2);font-weight:600}
.scp .scp-prov,#modalCard .scp .scp-prov,.scp .scp-model,#modalCard .scp .scp-model{box-sizing:border-box;margin:0;min-width:0;height:auto;
 font:inherit;font-size:12px;color:var(--text,#dce6f2);color-scheme:dark;background:rgba(255,255,255,.05);
 border:1px solid var(--line,rgba(110,180,255,.22));border-radius:8px;padding:5px 8px;outline:none}
.scp .scp-prov,#modalCard .scp .scp-prov{flex:1 1 150px;width:auto;max-width:100%;cursor:pointer}
.scp .scp-mwrap{position:relative;flex:1 1 150px;min-width:0}
.scp .scp-model,#modalCard .scp .scp-model{display:block;width:100%}
.scp .scp-prov:focus,.scp .scp-model:focus{border-color:var(--accent,#5ec8ff)}
.scp .scp-prov:disabled,.scp .scp-model:disabled{opacity:.6;cursor:default}
.scp select option,.scp select optgroup{background:#131c30;color:var(--text,#dce6f2)}
.scp .scp-menu{position:absolute;left:0;right:0;top:100%;margin-top:3px;z-index:80;max-height:210px;overflow-y:auto;
 background:#131b2d;border:1px solid var(--line,rgba(110,180,255,.22));border-radius:9px;box-shadow:0 10px 28px rgba(0,0,0,.5)}
.scp .scp-menu[hidden]{display:none}
.scp .scp-opt{padding:7px 11px;font-size:12px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--text,#dce6f2)}
.scp .scp-opt:hover,.scp .scp-opt.scp-hi{background:var(--accent,#5ec8ff);color:#06121f}
.scp .scp-opt.scp-cur{font-weight:700}
.scp .scp-opt.scp-none,.scp .scp-opt.scp-none:hover{opacity:.6;cursor:default;white-space:normal;background:none;color:inherit}
.scp .scp-state{flex:1 1 100%;font-size:11px;white-space:pre-line;overflow-wrap:anywhere}
.scp .scp-state:empty{display:none}
.scp .scp-state.scp-ok{color:#4ade80}
.scp .scp-state.scp-err{color:#ff8a80}
.scp .scp-state.scp-busy{color:var(--dim,#8294ab)}
.scp .scp-retry{margin-left:6px;padding:1px 8px;font-size:11px;border-radius:7px;cursor:pointer}
.scp.scp-compact{position:relative;margin:0;gap:5px;font-size:11.5px}
.scp.scp-compact .scp-prov,.scp.scp-compact .scp-model{font-size:11.5px;padding:4px 7px}
.scp.scp-compact .scp-prov{flex:0 1 180px}
.scp.scp-compact .scp-mwrap{flex:0 1 190px}
.scp.scp-compact .scp-state{position:absolute;left:0;top:calc(100% + 4px);z-index:81;flex:none;width:max-content;max-width:min(360px,92vw);
 padding:5px 9px;border-radius:8px;background:#131b2d;border:1px solid var(--line,rgba(110,180,255,.22));box-shadow:0 8px 22px rgba(0,0,0,.45);cursor:pointer}
.scp.scp-inline{flex-wrap:nowrap}
.scp.scp-inline .scp-lead{max-width:45%}
.scp.scp-inline .scp-prov,#modalCard .scp.scp-inline .scp-prov{flex:1 1 0;min-width:64px}
.scp.scp-inline .scp-mwrap{flex:1 1 0;min-width:64px}
.scp-msg{margin-top:6px;font-size:11.5px;line-height:1.45;white-space:pre-line;overflow-wrap:anywhere;color:var(--dim,#8294ab)}
.scp-msg[hidden]{display:none}
.scp-msg.scp-err{color:#ffb4ab}
.scp-msg.scp-ok{color:#9fe3b8}
.scp-msg .scp-sub{margin-top:2px;color:var(--dim,#8294ab)}
.scp-msg .scp-rep{margin-top:6px;padding:4px 10px;font-size:11.5px;border-radius:8px;cursor:pointer}
.assistrow.scp-assist{flex-wrap:wrap}
.assistrow.scp-assist input{flex:1 1 150px}
`;
  function css() {
    if (typeof document === "undefined" || document.getElementById("scp-css")) return;
    const st = document.createElement("style");
    st.id = "scp-css";
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }

  // ── keep windows in agreement: refetch when this window comes back ─────────────
  let lastFocus = 0;
  function refetchOnFocus() {
    prune();
    if (!pickers.size && !subs.size) return;
    const now = Date.now();
    if (now - lastFocus < 800) return;
    lastFocus = now;
    settings(true).catch(() => {});
  }
  try { window.addEventListener("focus", refetchOnFocus); } catch { /* no events (tests) */ }
  try { document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refetchOnFocus(); }); } catch { /* no DOM */ }
  // Warm the snapshot, so the brain picker has its lists before the first copilot page opens.
  try { setTimeout(() => { if (!S.data && !S.inflight) settings().catch(() => {}); }, 600); } catch { /* no timers */ }

  window.ShinoCopilot = {
    version: 1,
    mountPicker, settings, setBrain, onChange, errorText,
    t: T, roleName, directorName, brainText, request, notice, relabel,
  };
})();
