#!/usr/bin/env node
/*
 * mcp-rria.js — el oficio de RRIA, sin consola (Aignition, 2026-08-16).
 *
 * POR QUÉ EXISTE
 *
 * RRIA no quería una consola: quería aplicar un cambio. Su oficio estaba cableado
 * como "corré este script de node", y de ahí salió toda la cadena: script → hace
 * falta consola → hace falta un permiso Bash → hace falta coincidencia por prefijo
 * sobre una ruta de Windows.
 *
 * El resultado, medido en el journal del daemon: 14 intentos con su propia
 * herramienta, 2 aprobados, 12 rechazados. Los 12 eran el MISMO comando escrito
 * distinto — con comillas, con barras normales, con barras dobles:
 *
 *   OK  node C:\...\modificar-agente.js C:\...\pedido.json
 *   NO  node "C:/.../modificar-agente.js" "..."
 *   NO  node C:\\...\\modificar-agente.js ...
 *   NO  node 'C:\...\modificar-agente.js' '...'
 *
 * El candado hacía lo correcto (bashscope.js compara texto literal por prefijo);
 * el problema es que pedirle a un modelo que escriba siempre el mismo string exacto
 * no es un mecanismo. Ya se había intentado enseñárselo con la skill
 * `windows-abs-path-in-bash`: 2 de 14.
 *
 * QUÉ CAMBIA
 *
 * Sus tres operaciones pasan a ser herramientas tipadas. RRIA recibe un objeto, no
 * escribe una línea de shell. Entonces:
 *
 *   - se le puede sacar Bash ENTERO — cero consola;
 *   - desaparece la clase de error de comillas y barras;
 *   - la definición viaja INLINE, así que tampoco necesita escribir JSON sueltos
 *     por el disco para pasárselos a un script.
 *
 * Más capacidad y menos superficie a la vez, que no suele pasar.
 *
 * DÓNDE ESTÁ LA BARRERA DE VERDAD — y no es este archivo
 *
 * Este proceso NO decide nada. Es un cliente tipado del daemon, que ya valida:
 * campos modificables (9), herramientas concedibles (whitelist, Bash nunca pelado),
 * modelos permitidos (3), intocables (main/rria/ceo, y `revisor` en el alta), y
 * motivo + pedidoPor obligatorios. Ver validarCambios() y las rutas /registry/agent/*
 * en daemon/server.js.
 *
 * Eso es a propósito: dos policy engines se desincronizan, y el día que difieran gana
 * el más flojo. Acá solo se valida lo que conviene fallar rápido y con mensaje claro.
 *
 * Vive en la carpeta de la oficina, que ningún agente puede escribir. RRIA no puede
 * reescribir esto para ampliarse.
 */
"use strict";

const http = require("http");

const OFICINA = "http://127.0.0.1:8787";   // fijo a propósito: no es parámetro
const INTOCABLES = {
  main: "main (Shino) es intocable: él decide y pide, no se lo modifica",
  rria: "RRIA no puede modificarse a sí misma — eso lo hace Sergio, por la pantalla",
  ceo: "el CEO no es un agente, es el asiento de Sergio",
};

// ---------------------------------------------------------------- daemon

function llamar(ruta, cuerpo) {
  return new Promise((resolve) => {
    const body = Buffer.from(JSON.stringify(cuerpo), "utf8");
    const req = http.request(OFICINA + ruta, {
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
        let r;
        try { r = JSON.parse(buf); } catch { r = { ok: false, error: buf || `HTTP ${res.statusCode}` }; }
        resolve(r);
      });
    });
    req.on("error", (e) => resolve({ ok: false, error: `no pude hablar con la oficina: ${e.message}` }));
    req.end(body);
  });
}

// Se reporta la respuesta del daemon tal cual. RRIA tiene escrito en su prompt que
// reporte la salida sin reinterpretarla; acá se le da algo que no invita a hacerlo.
const ok = (t) => ({ content: [{ type: "text", text: t }], isError: false });
const err = (t) => ({ content: [{ type: "text", text: t }], isError: true });

// ---------------------------------------------------------------- herramientas

const HERRAMIENTAS = [
  {
    name: "alta_agente",
    description:
      "Da de alta un agente NUEVO en la plantilla de la oficina. Solo crea: si el id ya " +
      "existe, falla (para cambiar uno existente usá modificar_agente). La definición va " +
      "inline, no en un archivo. Reportá la respuesta tal cual te la devuelve.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "minúsculas, números y _; empieza con letra. Ej: especialista_datos" },
        name: { type: "string", description: "nombre visible. Ej: Especialista de Datos" },
        role: { type: "string", description: "puesto y departamento. Ej: Datos - Especialista" },
        model: {
          type: "string",
          enum: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5-20251001"],
          description: "el cerebro. El más chico que sirva para el puesto",
        },
        prompt: { type: "string", description: "el prompt del puesto, ya redactado" },
        tools: {
          type: "array", items: { type: "string" },
          description:
            "permisos MÍNIMOS y justificados. Concedibles: Read, Glob, Grep, Skill, Write, " +
            "Edit, WebSearch, WebFetch, TodoWrite. Bash SOLO acotado — Bash(npm test:*) sí, " +
            "Bash pelado se rechaza.",
        },
        skills: { type: "array", items: { type: "string" }, description: "skills de la oficina" },
        persona: {
          type: "object",
          description: "expertise, personality, language, rules",
          properties: {
            expertise: { type: "string" }, personality: { type: "string" },
            language: { type: "string" }, rules: { type: "string" },
          },
        },
        readDirs: { type: "array", items: { type: "string" }, description: "lectura extra, rutas absolutas" },
        motivo: { type: "string", description: "por qué hace falta este puesto" },
        pedidoPor: { type: "string", description: "quién lo pidió. Sin esto estarías decidiendo sola" },
      },
      required: ["id", "name", "role", "model", "prompt", "tools", "motivo", "pedidoPor"],
      additionalProperties: false,
    },
  },
  {
    name: "modificar_agente",
    description:
      "Modifica un agente que YA existe. Solo lo pedido: no aproveches para tocar otra cosa. " +
      "Campos permitidos: tools, model, prompt, skills, readDirs, noTouch, persona, role, name. " +
      "Reportá la respuesta tal cual.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "el agente a modificar" },
        cambios: {
          type: "object",
          description: "SOLO los campos que cambian. Si te pidieron el modelo, va el modelo y nada más",
        },
        motivo: { type: "string", description: "por qué se cambia" },
        pedidoPor: { type: "string", description: "quién lo pidió" },
      },
      required: ["id", "cambios", "motivo", "pedidoPor"],
      additionalProperties: false,
    },
  },
  {
    name: "baja_agente",
    description:
      "Da de baja un agente existente. Solo si el pedido dice explícitamente 'baja': no " +
      "sustituyas una modificación por una baja. Reportá la respuesta tal cual.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "el agente a dar de baja" },
        motivo: { type: "string", description: "por qué se da de baja" },
        pedidoPor: { type: "string", description: "quién lo pidió" },
      },
      required: ["id", "motivo", "pedidoPor"],
      additionalProperties: false,
    },
  },
];

// Solo lo que conviene fallar rápido y con un mensaje que se entienda. El resto lo
// decide el daemon — ver la nota de arriba sobre no tener dos policy engines.
function rapido(nombre, a) {
  const id = String(a.id || "").trim();
  if (!id) return "falta el id del agente";
  if (nombre !== "alta_agente" && INTOCABLES[id]) return INTOCABLES[id];
  if (!String(a.motivo || "").trim()) return "falta el motivo";
  if (!String(a.pedidoPor || "").trim()) return "falta pedidoPor: quién pidió este cambio";
  if (nombre === "modificar_agente" &&
      (!a.cambios || typeof a.cambios !== "object" || !Object.keys(a.cambios).length)) {
    return "falta el objeto 'cambios' con al menos un campo";
  }
  return null;
}

async function ejecutar(nombre, a) {
  a = a && typeof a === "object" ? a : {};
  const mal = rapido(nombre, a);
  if (mal) return err(`RECHAZADO · ${mal}`);

  if (nombre === "alta_agente") {
    const { motivo, pedidoPor, ...def } = a;
    const r = await llamar("/registry/agent/create", { ...def, motivo, pedidoPor });
    return r && r.ok
      ? ok(`ALTA OK · ${r.id || def.id}\nQueda registrado quién lo pidió y por qué. Reportáselo al Director.`)
      : err(`RECHAZADO · ${(r && r.error) || "sin detalle"}`);
  }

  if (nombre === "modificar_agente") {
    const r = await llamar("/registry/agent/modify",
      { id: a.id, cambios: a.cambios, motivo: a.motivo, pedidoPor: a.pedidoPor });
    return r && r.ok
      ? ok(`MODIFICADO · ${r.id} · campos: ${(r.campos || []).join(", ")}\nReportáselo al Director.`)
      : err(`RECHAZADO · ${(r && r.error) || "sin detalle"}`);
  }

  if (nombre === "baja_agente") {
    const r = await llamar("/registry/agent/retire",
      { id: a.id, motivo: a.motivo, pedidoPor: a.pedidoPor });
    return r && r.ok
      ? ok(`BAJA OK · ${r.id} (${r.nombre || ""})\nReportáselo al Director.`)
      : err(`RECHAZADO · ${(r && r.error) || "sin detalle"}`);
  }

  return err(`herramienta desconocida: ${nombre}`);
}

// ---------------------------------------------------------------- MCP (stdio)
// JSON-RPC 2.0, un mensaje por línea. Sin dependencias: la oficina no las usa.

const PROTOCOLO = "2025-06-18";

function responder(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}
function fallar(id, code, message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }) + "\n");
}

async function manejar(m) {
  // Las notificaciones no llevan id y no se contestan.
  if (m.id === undefined || m.id === null) return;

  switch (m.method) {
    case "initialize":
      return responder(m.id, {
        // Se devuelve la versión que pidió el cliente cuando la entendemos.
        protocolVersion: (m.params && m.params.protocolVersion) || PROTOCOLO,
        capabilities: { tools: {} },
        serverInfo: { name: "rria", version: "1.0.0" },
      });

    case "tools/list":
      return responder(m.id, { tools: HERRAMIENTAS });

    case "tools/call": {
      const p = m.params || {};
      try {
        return responder(m.id, await ejecutar(p.name, p.arguments));
      } catch (e) {
        return responder(m.id, err(`falló la llamada: ${e.message}`));
      }
    }

    case "ping":
      return responder(m.id, {});

    default:
      return fallar(m.id, -32601, `método no soportado: ${m.method}`);
  }
}

let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let corte;
  while ((corte = buffer.indexOf("\n")) >= 0) {
    const linea = buffer.slice(0, corte).trim();
    buffer = buffer.slice(corte + 1);
    if (!linea) continue;
    let m;
    try { m = JSON.parse(linea); } catch { continue; }   // basura: se ignora, no se cae
    manejar(m).catch((e) => {
      if (m && m.id !== undefined && m.id !== null) fallar(m.id, -32603, String(e.message));
    });
  }
});
process.stdin.on("end", () => process.exit(0));
