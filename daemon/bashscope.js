// 🔒 Scoped Bash grants have to hold on their own (Aignition patch, 2026-08-16).
//
// Granting "Bash(git status:*)" keeps the Bash TOOL alive on the model. That is
// verified and unavoidable: denying the base tool kills every scoped allow with it.
// So a command that did NOT match a grant walked to the Security Center and waited
// for a human. On 2026-08-16, at 03:05, the owner stamped seven cards in seven
// seconds so an audit could finish — one of them `printf 'hola' > PRUEBA.txt` — and
// the read-only Reviewer wrote a file. The boundary was a click, and a click at 3am
// is not a boundary.
//
// So a scope-limited agent no longer gets to ask. Its command either matches the
// grants the owner wrote — and runs with no card at all — or it is refused. Two
// rules, and both are load-bearing:
//   1. Redirection and command substitution are refused outright. Without this,
//      the granted `git status:*` also covers `git status > file.txt`, and the
//      grant list itself becomes the write channel.
//   2. EVERY segment of a chained command must match on its own, so appending
//      `; printf x > f` to an allowed command cannot ride in on the prefix.
// `2>&1` and `>/dev/null` are the exceptions: they merge or discard output and
// cannot create a file.
//
// This runs on the daemon side, at /perm/request, so it also covers ghost clones:
// "revisor#s1" resolves back to "revisor" before the grants are read.

const SAFE_REDIRECT = /\s(?:2>&1|[12]?>>?\s*\/dev\/null)/g;

// 🚫 Zonas que un agente no puede nombrar en un comando (Aignition, 2026-08-16).
//
// El Implementador es el único agente con escritura, y necesita Bash ancho para su
// trabajo: git, node, npm. Pero `Bash(node:*)` también cubre
// `node -e "fs.writeFileSync('…/BagIdeaOffice/daemon/settings_implementador.json')"`,
// y ahí el único que escribe se afloja su propio candado y el del Revisor.
//
// No hay forma de conceder "node sí pero no para escribir ahí" con permisos por
// prefijo. Así que la zona se declara por agente (campo `noTouch` del registro) y
// ningún comando suyo puede mencionarla. Es una guarda, no una jaula: una ruta
// ofuscada la pasa. Se sostiene junto con las otras dos capas —el Implementador no
// tiene la carpeta en `readDirs`, así que sus herramientas de archivo no la alcanzan,
// y el Revisor audita— y con eso alcanza para el riesgo que cubre.
// Normaliza para comparar: barras en un solo sentido, repetidas colapsadas, y sin
// mayúsculas. Lo de las repetidas no es cosmético — dentro de `node -e "…"` la ruta
// va escapada (`C:\\Users\\…`), y sin colapsar, la forma más natural de escribir el
// ataque pasaba limpia. Lo encontró el propio test, no el diseño.
const normPath = (s) => String(s || "").replace(/\//g, "\\").replace(/\\+/g, "\\").toLowerCase();

function hitsForbidden(raw, forbidden) {
  const hay = normPath(raw);
  for (const f of forbidden) {
    const needle = normPath(f);
    if (needle && hay.includes(needle)) return f;
  }
  return null;
}

// grants: the agent's scoped entries, e.g. ["Bash(npm test:*)", "Bash(git log:*)"].
// forbidden: absolute paths this agent may not name at all.
// Returns { ok: true } or { ok: false, why: "<reason in the owner's language>" }.
function bashScopeVerdict(cmd, grants, forbidden = []) {
  const raw = String(cmd || "");
  if (!raw.trim()) return { ok: false, why: "comando vacío" };

  const zona = hitsForbidden(raw, forbidden);
  if (zona) return { ok: false, why: `nombra una zona cerrada para este agente (${zona})` };

  const probe = raw.replace(SAFE_REDIRECT, " ");
  if (/[<>]/.test(probe)) return { ok: false, why: "redirección a un archivo" };
  if (/`|\$\(/.test(probe)) return { ok: false, why: "sustitución de comandos" };

  // "Bash(git status:*)" → prefix "git status"; "Bash(echo hola)" → exact match.
  const parsed = grants
    .filter((g) => /^Bash\(.+\)$/.test(g))
    .map((g) => g.slice(5, -1))
    .map((p) => ({ text: p.replace(/:\*$/, ""), prefix: /:\*$/.test(p) }));
  if (!parsed.length) return { ok: false, why: "sin permisos de consola" };

  const segments = raw.split(/\n|;|&&|\|\||\|/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const bare = seg.replace(SAFE_REDIRECT, " ").trim();
    const hit = parsed.some(({ text, prefix }) => prefix
      ? (bare === text || bare.startsWith(text + " "))
      : bare === text);
    if (!hit) return { ok: false, why: `"${bare.slice(0, 60)}" no está en sus permisos` };
  }
  return { ok: true };
}

module.exports = { bashScopeVerdict, hitsForbidden };
