// BagIdea Office — budgets in money, not tokens.
//
// Before this, the only limit on spend was a per-request CONTEXT budget. Nothing
// stopped a thread that ran to 9.5M tokens (issue #46) except a person reading
// a meter, and an office that runs while you're away (v1.3+) has no person.
//
// Caps live in reg.budget:
//   { office: { daily: 5 },                 USD per calendar day, whole office
//     agents: { marcus: { daily: 2 } },     per agent per day
//     projects: { shop: { total: 40 } },    per project, lifetime
//     digest: { enabled: true, time: "08:00" } }
//
// Spend comes from the stats the office already keeps per day:
//   stats[day].cost           Claude's real bill (total_cost_usd, per turn)
//   stats[day].brains[p].cost swapped-in brains, ESTIMATED from tokens × price
//   stats[day].aux[p]         voice / image / video, ESTIMATED per use
//   stats[day].agentCost[id]  per-agent attribution (added in v1.2)
//   stats[day].projCost[id]   per-project attribution (added in v1.2)
//
// Two behaviours, in this order: at 80% of a cap, warn once per day per scope;
// at 100%, STOP — a new turn is refused with a message, running turns finish.
// Where a price is unknown the number is an estimate and is LABELLED as one;
// it is never silently treated as zero.
//
// Zero dependencies.

const WARN_AT = 0.8;

module.exports = function initBudget(ctx) {
  const reg = ctx.reg;
  const saveReg = ctx.saveReg || (() => {});
  const stats = () => ctx.stats();               // the live stats object
  const notify = ctx.notify || (() => {});
  const log = ctx.log || (() => {});
  const now = ctx.now || (() => Date.now());
  const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

  const warned = new Map();                       // "day|scope" -> true

  function caps() {
    const b = reg.budget || {};
    return {
      office: { daily: num(b.office && b.office.daily) },
      agents: mapNum(b.agents, "daily"),
      projects: mapNum(b.projects, "total"),
      digest: { enabled: !!(b.digest && b.digest.enabled), time: (b.digest && /^\d\d:\d\d$/.test(b.digest.time) ? b.digest.time : "08:00") },
    };
  }
  function num(v) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; }
  function mapNum(o, key) {
    const out = {};
    for (const [k, v] of Object.entries(o || {})) { const n = num(v && v[key]); if (n) out[k] = n; }
    return out;
  }

  function setCaps(patch) {
    reg.budget = reg.budget || {};
    if (patch.office && "daily" in patch.office) reg.budget.office = { daily: num(patch.office.daily) };
    for (const [scope, key] of [["agents", "daily"], ["projects", "total"]]) {
      if (!patch[scope] || typeof patch[scope] !== "object") continue;
      reg.budget[scope] = reg.budget[scope] || {};
      for (const [id, v] of Object.entries(patch[scope])) {
        const n = num(v && v[key]);
        if (n) reg.budget[scope][id] = { [key]: n }; else delete reg.budget[scope][id];
      }
    }
    if (patch.digest && typeof patch.digest === "object") {
      reg.budget.digest = { enabled: !!patch.digest.enabled,
        time: /^\d\d:\d\d$/.test(patch.digest.time || "") ? patch.digest.time : "08:00" };
    }
    saveReg();
    return caps();
  }

  // ---- the ledger ------------------------------------------------------------
  function dayTotals(day) {
    const d = (stats() || {})[day] || {};
    const real = Number(d.cost) || 0;
    let est = 0;
    for (const b of Object.values(d.brains || {})) est += Number(b.cost) || 0;
    for (const v of Object.values(d.aux || {})) est += Number(v) || 0;
    return { real, est, total: round(real + est), estimated: est > 0 };
  }
  function agentSpend(id, day) {
    const d = (stats() || {})[day] || {};
    return round(Number((d.agentCost || {})[id]) || 0);
  }
  function projectSpend(id) {
    let t = 0, est = false;
    for (const d of Object.values(stats() || {})) {
      const c = Number((d.projCost || {})[id]) || 0; t += c;
      if (c && d.brains && Object.keys(d.brains).length) est = true;
    }
    return { total: round(t), estimated: est };
  }
  function round(n) { return Math.round(n * 10000) / 10000; }

  // Record a turn's cost against its agent and project (stats keep the day total).
  function attribute(agent, projId, usd, at) {
    if (!usd || usd <= 0) return;
    const day = dayOf(at || now());
    const s = stats();
    const d = (s[day] = s[day] || { runs: 0, done: 0, failed: 0, cost: 0, agents: {} });
    if (agent) { d.agentCost = d.agentCost || {}; const base = String(agent).split("#")[0]; d.agentCost[base] = round((d.agentCost[base] || 0) + usd); }
    if (projId) { d.projCost = d.projCost || {}; d.projCost[projId] = round((d.projCost[projId] || 0) + usd); }
  }

  // ---- the gate --------------------------------------------------------------
  // Called before a turn starts. ok:false means refuse. Warnings are sent once
  // per day per scope, never repeated on every turn.
  function check(agent, projId, at) {
    const t = at || now(), day = dayOf(t), c = caps();
    const base = String(agent || "").split("#")[0];
    const scopes = [];
    if (c.office.daily) scopes.push({ scope: "office", id: "", cap: c.office.daily, spent: dayTotals(day).total, estimated: dayTotals(day).estimated, unit: "today" });
    if (base && c.agents[base]) scopes.push({ scope: "agent", id: base, cap: c.agents[base], spent: agentSpend(base, day), estimated: dayTotals(day).estimated, unit: "today" });
    if (projId && c.projects[projId]) { const p = projectSpend(projId); scopes.push({ scope: "project", id: projId, cap: c.projects[projId], spent: p.total, estimated: p.estimated, unit: "total" }); }
    for (const s of scopes) {
      const pct = s.spent / s.cap;
      if (pct >= 1) {
        const key = day + "|stop|" + s.scope + "|" + s.id;
        if (!warned.has(key)) { warned.set(key, true); notify(budgetNote("stop", s)); }
        return { ok: false, level: "stop", ...s, pct: round(pct) };
      }
      if (pct >= WARN_AT) {
        const key = day + "|warn|" + s.scope + "|" + s.id;
        if (!warned.has(key)) { warned.set(key, true); notify(budgetNote("warn", s)); }
      }
    }
    return { ok: true, level: "ok", scopes };
  }

  function label(s) { return s.scope === "office" ? "the office" : s.scope + " " + s.id; }
  function usd(n) { return "$" + (Math.round(n * 100) / 100).toFixed(2); }
  function budgetNote(level, s) {
    const est = s.estimated ? " (estimated)" : "";
    return level === "stop"
      ? { kind: "budget", title: `💸 Budget reached — ${label(s)}`,
          body: `${usd(s.spent)}${est} of ${usd(s.cap)} ${s.unit}. New turns are refused until ${s.unit === "today" ? "tomorrow" : "the cap is raised"}. Raise it in ⚙ → 💸 BUDGET or with \`bagidea budget\`.` }
      : { kind: "budget", title: `💸 ${Math.round(s.spent / s.cap * 100)}% of budget — ${label(s)}`,
          body: `${usd(s.spent)}${est} of ${usd(s.cap)} ${s.unit}.` };
  }

  // What the panel, STATS and the CLI show.
  function summary(at) {
    const t = at || now(), day = dayOf(t), c = caps(), tot = dayTotals(day);
    const agents = {};
    for (const [id, cap] of Object.entries(c.agents)) agents[id] = { cap, spent: agentSpend(id, day) };
    const d = (stats() || {})[day] || {};
    for (const id of Object.keys(d.agentCost || {})) if (!agents[id]) agents[id] = { cap: 0, spent: agentSpend(id, day) };
    const projects = {};
    for (const [id, cap] of Object.entries(c.projects)) projects[id] = { cap, ...projectSpend(id) };
    return { day, office: { cap: c.office.daily, spent: tot.total, real: tot.real, estimated: tot.estimated }, agents, projects, digest: c.digest,
      warnAt: WARN_AT, note: tot.estimated ? "includes estimated spend for brains and tools that do not report a bill" : "" };
  }

  // ---- the morning digest ----------------------------------------------------
  let lastDigestDay = "";
  function digestDue(at) {
    const c = caps(); if (!c.digest.enabled) return false;
    const t = at || now(), d = new Date(t), day = dayOf(t);
    if (lastDigestDay === day) return false;
    const [hh, mm] = c.digest.time.split(":").map(Number);
    return d.getHours() > hh || (d.getHours() === hh && d.getMinutes() >= mm);
  }
  function digestText(at, extra = {}) {
    const t = at || now();
    const y = dayOf(t - 86400000), tot = dayTotals(y), d = (stats() || {})[y] || {};
    const est = tot.estimated ? " (part estimated)" : "";
    const top = Object.entries(d.agentCost || {}).sort((a, b) => b[1] - a[1]).slice(0, 3)
      .map(([id, c]) => `${id} ${usd(c)}`).join(" · ");
    return [
      `🌅 Yesterday (${y}): ${usd(tot.total)}${est} · ${d.runs || 0} turns · ${d.done || 0} done · ${d.failed || 0} failed`,
      top ? `Top spend: ${top}` : "",
      extra.pending ? `📥 ${extra.pending} waiting for you` : "",
      extra.workflows ? `🔀 ${extra.workflows} workflow run(s)` : "",
    ].filter(Boolean).join("\n");
  }
  function sendDigest(at, extra) {
    const t = at || now();
    lastDigestDay = dayOf(t);
    const text = digestText(t, extra);
    notify({ kind: "system", title: "🌅 Morning digest", body: text });
    return text;
  }

  return { WARN_AT, caps, setCaps, check, attribute, summary, dayTotals, agentSpend, projectSpend,
           digestDue, digestText, sendDigest, _warned: warned };
};
