#!/usr/bin/env node
/*
 * proponer-cambio.js — paso 1 de 2. Lo corre RRIA (Aignition, 2026-08-16).
 *
 * Proponer NO cambia nada. Deja el cambio pendiente hasta que Shino lo apruebe con
 * aprobar-cambio.js, que RRIA no puede correr.
 *
 * La separación es el control: RRIA propone y no aprueba, Shino aprueba y no propone.
 * Ninguno de los dos cierra el circuito solo.
 *
 *   node tools/proponer-cambio.js <ruta-al-json>
 *
 * El JSON: { "id": "<agente>", "motivo": "<por que>", "cambios": { ... } }
 * Intocables: main (Shino), rria (vos misma) y ceo (el asiento de Sergio).
 */
const fs = require("fs");
const http = require("http");
const path = require("path");

const file = process.argv[2];
if (!file) {
  console.error("uso: node tools/proponer-cambio.js <ruta-al-json>");
  process.exit(2);
}
let def;
try { def = JSON.parse(fs.readFileSync(path.resolve(file), "utf8")); }
catch (e) { console.error(`no pude leer la propuesta: ${e.message}`); process.exit(2); }

const body = Buffer.from(JSON.stringify(def), "utf8");
const req = http.request("http://127.0.0.1:8787/registry/agent/propose", {
  method: "POST",
  headers: { "x-bagidea-ui": "1", "content-type": "application/json; charset=utf-8",
    "content-length": body.length },
}, (res) => {
  let buf = ""; res.setEncoding("utf8");
  res.on("data", (c) => { buf += c; });
  res.on("end", () => {
    let r = {}; try { r = JSON.parse(buf); } catch { r = { error: buf }; }
    if (r.ok) {
      console.log(`PROPUESTO · ${r.cambio} · sobre ${r.agent} · campos: ${(r.campos || []).join(", ")}`);
      console.log("NO se aplico nada todavia. Pedile a Shino que lo apruebe pasandole");
      console.log(`el id del cambio: ${r.cambio}`);
      process.exit(0);
    }
    console.error(`PROPUESTA RECHAZADA · ${r.error || buf}`);
    process.exit(1);
  });
});
req.on("error", (e) => { console.error(`no pude hablar con la oficina: ${e.message}`); process.exit(3); });
req.end(body);
