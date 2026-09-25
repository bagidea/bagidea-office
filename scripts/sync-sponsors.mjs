#!/usr/bin/env node
/* Sync GitHub Sponsors -> web/sponsors.json (+ the README sponsors block).
 *
 * Reads the live sponsor list from the GitHub Sponsors GraphQL API, maps each
 * to a tier by monthly amount, MERGES with the hand-edited off-platform list
 * (web/sponsors.manual.json), and writes the generated web/sponsors.json that
 * the website renders. Run by .github/workflows/sponsors.yml on a schedule.
 *
 * Env:
 *   SPONSORS_TOKEN  classic PAT of the sponsored account, scope `read:user`
 *                   (required to read private sponsors; public-only works too).
 *   SPONSORS_LOGIN  account login (default "bagidea").
 *
 * Zero dependencies — uses Node 18+ global fetch. Amounts are NEVER written to
 * a displayed field; `weight` is the private sort key only.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANUAL = join(ROOT, "web/sponsors.manual.json");
const OUT = join(ROOT, "web/sponsors.json");
const README = join(ROOT, "README.md");
const LOGIN = process.env.SPONSORS_LOGIN || "bagidea";
const TOKEN = (process.env.SPONSORS_TOKEN || "").trim();
// Reject anything that isn't a plausible GitHub token shape before it is ever
// sent in an Authorization header — guards against a malformed/truncated
// value (e.g. accidental injection of other data) leaking to the API call.
if (TOKEN && !/^(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})$/.test(TOKEN)) {
  console.error("✗ SPONSORS_TOKEN is set but has an invalid format — refusing to use it");
  process.exit(1);
}
const RAW = `https://raw.githubusercontent.com/${"bagidea"}/bagidea-office/main/web/`;

// monthly $ -> tier (must match the tiers in sponsors.manual.json)
function tierFor(usd) {
  if (usd >= 3000) return "gold";
  if (usd >= 300) return "silver";
  if (usd >= 30) return "bronze";
  return "supporter";
}
const ym = (iso) => (iso ? String(iso).slice(0, 7) : "");

async function fetchGitHubSponsors() {
  if (!TOKEN) {
    console.warn("• no SPONSORS_TOKEN — skipping GitHub fetch (manual list only)");
    return [];
  }
  const out = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const q = `query($login:String!,$after:String){
      user(login:$login){
        sponsorshipsAsMaintainer(first:100, after:$after, activeOnly:true,
          orderBy:{field:CREATED_AT, direction:ASC}){
          pageInfo{ hasNextPage endCursor }
          nodes{
            createdAt privacyLevel
            tier{ monthlyPriceInDollars isOneTime }
            sponsorEntity{
              __typename
              ... on User{ login name avatarUrl url websiteUrl }
              ... on Organization{ login name avatarUrl url websiteUrl }
            }
          }
        }
      }
    }`;
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "bagidea-office-sponsors-sync",
      },
      body: JSON.stringify({ query: q, variables: { login: LOGIN, after } }),
    });
    if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${await res.text()}`);
    const json = await res.json();
    if (json.errors) throw new Error("GraphQL: " + JSON.stringify(json.errors));
    const conn = json.data?.user?.sponsorshipsAsMaintainer;
    if (!conn) break;
    for (const n of conn.nodes || []) {
      // respect privacy — only show sponsors who chose PUBLIC
      if (n.privacyLevel !== "PUBLIC") continue;
      const e = n.sponsorEntity;
      if (!e) continue;
      const usd = n.tier?.monthlyPriceInDollars || 0;
      out.push({
        name: e.name || e.login,
        login: e.login,
        tier: tierFor(usd),
        weight: usd,
        url: e.websiteUrl || e.url,
        logo: e.avatarUrl,
        since: ym(n.createdAt),
      });
    }
    if (!conn.pageInfo?.hasNextPage) break;
    after = conn.pageInfo.endCursor;
  }
  console.log(`• GitHub: ${out.length} public sponsor(s)`);
  return out;
}

function mergeManual(manualList, ghList) {
  // manual entries win + are pinned by their (often huge) weight; drop GitHub
  // duplicates matched by login or name (case-insensitive)
  const keys = new Set();
  for (const m of manualList) {
    if (m.login) keys.add(m.login.toLowerCase());
    if (m.name) keys.add(m.name.toLowerCase());
  }
  const extra = ghList.filter(
    (g) => !keys.has((g.login || "").toLowerCase()) && !keys.has((g.name || "").toLowerCase())
  );
  // strip the helper `login` field from the public output
  const clean = (s) => {
    const { login, ...rest } = s;
    return rest;
  };
  return [...manualList, ...extra].map(clean);
}

const ORDER = ["gold", "silver", "bronze", "supporter"];
function readmeBlock(tiers, sponsors) {
  const byTier = {};
  for (const s of sponsors) (byTier[s.tier] ||= []).push(s);
  for (const k in byTier) byTier[k].sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const abs = (logo) => (/^https?:\/\//.test(logo || "") ? logo : RAW + logo);
  const head = { gold: "👑 Gold Partners", silver: "🥈 Silver Partners", bronze: "🥉 Bronze · Backers", supporter: "💛 Supporters" };
  const lines = [];
  for (const tier of ORDER) {
    const g = byTier[tier];
    if (!g?.length) continue;
    lines.push(`### ${head[tier]}`, "");
    if (tier === "gold" || tier === "silver") {
      const h = tier === "gold" ? 110 : 70;
      lines.push("<p align=\"center\">");
      for (const s of g)
        lines.push(`  <a href="${s.url}" target="_blank"><img src="${abs(s.logo)}" height="${h}" alt="${s.name}"></a>`);
      lines.push("</p>");
      lines.push(`<p align="center">${g.map((s) => `<b><a href="${s.url}">${s.name}</a></b>`).join(" · ")}</p>`, "");
    } else {
      lines.push(g.map((s) => (s.url ? `[${s.name}](${s.url})` : s.name)).join(" · "), "");
    }
  }
  return lines.join("\n").trim();
}

function updateReadme(tiers, sponsors) {
  if (!existsSync(README)) return false;
  const txt = readFileSync(README, "utf8");
  const A = "<!-- sponsors:start -->", B = "<!-- sponsors:end -->";
  const i = txt.indexOf(A), j = txt.indexOf(B);
  if (i < 0 || j < 0 || j < i) {
    console.warn("• README has no sponsors markers — skipping README update");
    return false;
  }
  const next = txt.slice(0, i + A.length) + "\n" + readmeBlock(tiers, sponsors) + "\n" + txt.slice(j);
  if (next === txt) return false;
  writeFileSync(README, next);
  return true;
}

(async () => {
  const manual = JSON.parse(readFileSync(MANUAL, "utf8"));
  const gh = await fetchGitHubSponsors();
  const sponsors = mergeManual(manual.sponsors || [], gh);
  const output = {
    _comment:
      "GENERATED by scripts/sync-sponsors.mjs — do NOT hand-edit. For off-platform sponsors edit web/sponsors.manual.json; GitHub Sponsors are pulled automatically. `weight` is a private sort key (never displayed).",
    tiers: manual.tiers,
    sponsors,
  };
  writeFileSync(OUT, JSON.stringify(output, null, 2) + "\n");
  const r = updateReadme(manual.tiers, sponsors);
  console.log(`✓ wrote web/sponsors.json (${sponsors.length} sponsor(s))${r ? " + README" : ""}`);
})().catch((e) => {
  console.error("✗ sync failed:", e.message);
  process.exit(1);
});
