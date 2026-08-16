#!/usr/bin/env node
/*
 * modificar-agente.js — lo corre RRIA, y nadie más (Aignition, 2026-08-16).
 *
 * RRIA es la única que toca la plantilla: crea, modifica y da de baja. Shino NO toca
 * a nadie: decide y se lo pide a RRIA. Ésa es la cadena.
 *
 *   especialista o gerente pide  →  Shino evalúa y DECIDE  →  RRIA CONSTRUYE
 *
 * Por eso el JSON exige `pedidoPor` además de `motivo`. Un cambio sin quién lo pidió
 * es RRIA decidiendo sola, y eso no es su puesto.
 *
 *   node tools/modificar-agente.js <ruta-al-json>
 *   node tools/modificar-agente.js --baja <ruta-al-json>
 *
 * Modificar: { "id", "motivo", "pedidoPor", "cambios": { tools?, model?, prompt?, … } }
 * Baja:      { "id", "motivo", "pedidoPor" }
 *
 * Intocables por cualquiera de las dos vías: main (Shino), rria (ella misma), ceo.
 */
const fs = require("fs");
const http = require("http");
const path = require("path");

const args = process.argv.slice(2);
const baja = args[0] === "--baja";
const file = baja ? args[1] : args[0];
if (!file) {
  console.error("uso: node tools/modificar-agente.js [--baja] <ruta-al-json>");
  process.exit(2);
}
let def;
try { def = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); }
catch (e) { console.error(`no pude leer el pedido: ${e.message}`); process.exit(2); }

const ruta = baja ? "/registry/agent/retire" : "/registry/agent/modify";
const body = Buffer.from(JSON.stringify(def), "utf8");
const req = http.request("http://127.0.0.1:8787" + ruta, {
  method: "POST",
  headers: { "x-bagidea-ui": "1", "content-type": "application/json; charset=utf-8",
    "content-length": body.length },
}, (res) => {
  let buf = ""; res.setEncoding("utf8");
  res.on("data", (c) => { buf += c; });
  res.on("end", () => {
    let r = {}; try { r = JSON.parse(buf); } catch { r = { error: buf }; }
    if (r.ok) {
      if (baja) console.log(`BAJA OK · ${r.id} (${r.nombre})`);
      else console.log(`MODIFICADO · ${r.id} · campos: ${(r.campos || []).join(", ")}`);
      console.log("Queda registrado quién lo pidió y por qué. Reportáselo a Shino.");
      process.exit(0);
    }
    console.error(`RECHAZADO · ${r.error || buf}`);
    process.exit(1);
  });
});
req.on("error", (e) => { console.error(`no pude hablar con la oficina: ${e.message}`); process.exit(3); });
req.end(body);
