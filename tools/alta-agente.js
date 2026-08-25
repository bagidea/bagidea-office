#!/usr/bin/env node
/*
 * alta-agente.js — el lanzador de la puerta angosta (Aignition, 2026-08-16).
 *
 * Lo corre RRIA, que es el único puesto con la concesión acotada para invocarlo.
 * Toma un archivo JSON con la definición del puesto y se lo pasa a la ruta
 * /registry/agent/create del daemon.
 *
 * POR QUÉ VIVE ACÁ Y NO EN EL REPO. Si viviera en el repo, el Implementador —que
 * es el único agente con escritura sobre el repo— podría reescribirlo, y entonces
 * RRIA estaría ejecutando lo que el Implementador quisiera. Sería una escalada de
 * privilegios en dos pasos. Acá adentro no lo alcanza ninguno de los dos: RRIA no
 * tiene esta carpeta en sus directorios legibles, y el Implementador la tiene
 * declarada como zona cerrada.
 *
 * Este script NO valida nada por su cuenta a propósito: la validación vive en el
 * daemon, del otro lado. Un script que valida y una ruta que confía es una ruta
 * sin validar el día que alguien llama la ruta directo.
 *
 *   node tools/alta-agente.js <ruta-al-json-del-puesto>
 */
const fs = require("fs");
const http = require("http");
const path = require("path");

const file = process.argv[2];
if (!file) {
  console.error("uso: node tools/alta-agente.js <ruta-al-json-del-puesto>");
  process.exit(2);
}

let def;
try {
  def = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
} catch (e) {
  console.error(`no pude leer la definición: ${e.message}`);
  process.exit(2);
}

const body = Buffer.from(JSON.stringify(def), "utf8");
const req = http.request("http://127.0.0.1:8787/registry/agent/create", {
  method: "POST",
  headers: {
    "x-bagidea-ui": "1",
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
  },
}, (res) => {
  let buf = "";
  res.setEncoding("utf8");
  res.on("data", (c) => { buf += c; });
  res.on("end", () => {
    let r = {};
    try { r = JSON.parse(buf); } catch { r = { ok: false, error: buf }; }
    if (r.ok) {
      console.log(`ALTA OK · ${r.id} · modelo ${r.model}`);
      console.log(`herramientas: ${(r.tools || []).join(", ") || "(ninguna)"}`);
      console.log("El agente queda dado de alta. La configuración de un agente que YA");
      console.log("existe no se toca por acá: eso sigue siendo de Sergio, por pantalla.");
      process.exit(0);
    }
    console.error(`ALTA RECHAZADA · ${r.error || buf}`);
    process.exit(1);
  });
});
req.on("error", (e) => {
  console.error(`no pude hablar con la oficina: ${e.message}`);
  console.error("¿está levantada? node daemon\\server.js desde %LOCALAPPDATA%\\BagIdeaOffice");
  process.exit(3);
});
req.end(body);
