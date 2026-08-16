#!/usr/bin/env node
/*
 * aprobar-cambio.js — paso 2 de 2. Lo corre SHINO (Aignition, 2026-08-16).
 *
 * Recién acá el cambio existe. RRIA no puede correr este script, y Shino no puede
 * correr el de proponer: ninguno de los dos cierra el circuito solo.
 *
 * Antes de aprobar, MIRÁ qué estás aprobando:
 *   node tools/aprobar-cambio.js            → lista lo pendiente
 *   node tools/aprobar-cambio.js <id>       → lo aplica
 *
 * Aprobar un cambio de permisos no es un trámite. Si no entendés por qué alguien
 * necesita lo que pide, la respuesta es no aprobarlo y preguntar.
 */
const http = require("http");

const id = (process.argv[2] || "").trim();

function pedir(metodo, ruta, cuerpo, cb) {
  const body = cuerpo ? Buffer.from(JSON.stringify(cuerpo), "utf8") : null;
  const req = http.request("http://127.0.0.1:8787" + ruta, {
    method: metodo,
    headers: {
      "x-bagidea-ui": "1",
      ...(body ? { "content-type": "application/json; charset=utf-8", "content-length": body.length } : {}),
    },
  }, (res) => {
    let buf = ""; res.setEncoding("utf8");
    res.on("data", (c) => { buf += c; });
    res.on("end", () => { let r; try { r = JSON.parse(buf); } catch { r = { error: buf }; } cb(r); });
  });
  req.on("error", (e) => { console.error(`no pude hablar con la oficina: ${e.message}`); process.exit(3); });
  if (body) req.write(body);
  req.end();
}

if (!id) {
  pedir("GET", "/registry/agent/pending", null, (lista) => {
    if (!Array.isArray(lista) || !lista.length) { console.log("No hay cambios pendientes."); return; }
    console.log("CAMBIOS PENDIENTES DE TU APROBACION:\n");
    for (const c of lista) {
      console.log(`  ${c.cambio}  sobre ${c.agent}`);
      console.log(`     campos: ${(c.campos || []).join(", ")}`);
      console.log(`     motivo: ${c.motivo}`);
      console.log(`     lo propuso: ${c.por}\n`);
    }
    console.log("Para aplicar uno: node tools/aprobar-cambio.js <id>");
  });
} else {
  pedir("POST", "/registry/agent/approve", { cambio: id }, (r) => {
    if (r.ok) {
      console.log(`APLICADO · ${r.cambio} · sobre ${r.agent} · campos: ${(r.campos || []).join(", ")}`);
      console.log("Queda registrado quien lo propuso y que vos lo aprobaste. Informaselo a Sergio.");
      process.exit(0);
    }
    console.error(`RECHAZADO · ${r.error}`);
    process.exit(1);
  });
}
