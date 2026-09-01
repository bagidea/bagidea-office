// BagIdea Office — execution backends.
//
// Every agent run is `claude -p …` spawned by the daemon. Until now that only
// ever happened on the owner's own machine, which means an agent that goes
// wrong goes wrong on the real desktop, and the office can never be bigger than
// one computer. This module sits between "here are the claude arguments" and
// the actual spawn, and answers: WHERE does this run?
//
//   local   the machine the office is on. Exactly what happened before.
//   docker  a throwaway container. The blast radius is the mounts, nothing else.
//   ssh     another machine that has its own office checkout.
//
// The whole difficulty is PATHS. The argument list carries host paths — the
// permission-broker settings file, the agent's skills directory, a generated
// --mcp-config. Inside a container none of those exist at that path, and on a
// Windows host they cannot even be the same shape. So the backends do not just
// prefix a command: they translate the argument list into the paths the other
// side will actually see, and refuse to run when they cannot.
//
// Refusing matters more than it sounds. --settings is what installs the
// permission broker; a run that quietly loses it is a run with no Security
// Center, doing whatever it likes. Better to fail loudly than to sandbox an
// agent into a place where nothing is watching it.

const path = require("path");

// POSIX single-quote: the only character that matters inside '' is ' itself.
const shq = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

// Host path → the path the other side sees. Longest prefix wins, so a project
// inside the office root maps to the project mount, not the office one.
function remapPath(p, maps) {
  const s = String(p);
  let best = null;
  for (const m of maps) {
    const from = m.from.replace(/[\\/]+$/, "");
    if (!from) continue;
    const same = s.length === from.length, sep = s[from.length];
    if (s.toLowerCase().startsWith(from.toLowerCase()) && (same || sep === "/" || sep === "\\")) {
      if (!best || from.length > best.from.length) best = { from, to: m.to };
    }
  }
  if (!best) return null;
  const rest = s.slice(best.from.length).replace(/\\/g, "/").replace(/^\/+/, "");
  return rest ? best.to.replace(/\/+$/, "") + "/" + rest : best.to;
}

// Rewrite every argument that names a host path. Claude's flags come as
// "--flag" followed by its value, so only those values are candidates — an
// argument that merely CONTAINS something path-shaped (a prompt, a tool list)
// is left alone.
const PATH_FLAGS = new Set(["--settings", "--add-dir", "--mcp-config"]);

function remapArgs(args, maps) {
  const out = [], missed = [];
  for (let i = 0; i < args.length; i++) {
    out.push(args[i]);
    if (!PATH_FLAGS.has(args[i]) || i + 1 >= args.length) continue;
    const val = args[++i];
    const to = remapPath(val, maps);
    if (to === null) { missed.push(args[i - 1] + " " + val); out.push(val); }
    else out.push(to);
  }
  return { args: out, missed };
}

// Pass a variable by NAME so its value travels in the docker client's own
// environment instead of the command line. An API key on an argv is a key in
// every process listing on the machine.
function envFlags(env, base) {
  const names = [];
  for (const k of Object.keys(env || {})) {
    if (base && base[k] === env[k]) continue;      // unchanged from our own env
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    names.push(k);
  }
  return names;
}

// spec.kind: local | docker | ssh
// ctx: { argv, cwd, env, officeRoot }
// → { file, args, options, describe } or throws with a message meant for the owner.
function plan(spec, ctx) {
  const kind = (spec && spec.kind) || "local";
  const { argv, cwd, env, officeRoot } = ctx;

  if (kind === "local") {
    return {
      file: "claude", args: argv,
      // shell:true is how `claude` resolves on Windows, where it is claude.cmd.
      options: { cwd, shell: true, env },
      describe: "local",
    };
  }

  if (kind === "docker") {
    const image = String(spec.image || "").trim();
    if (!image) throw new Error("docker backend has no image set");
    const maps = [
      { from: officeRoot, to: "/office" },
      { from: cwd, to: "/work" },
    ];
    const { args: mapped, missed } = remapArgs(argv, maps);
    if (missed.length) {
      throw new Error(
        "docker backend cannot see " + missed.join(", ") +
        " — it is outside both the office root and the working directory, so the " +
        "container would run without it");
    }
    const run = ["run", "--rm", "-i"];
    // The office root is read-only: the container reads settings and skills from
    // it and has no business writing there. The working directory is not.
    run.push("-v", officeRoot + ":/office:ro");
    if (path.resolve(cwd) !== path.resolve(officeRoot)) run.push("-v", cwd + ":/work");
    run.push("-w", path.resolve(cwd) === path.resolve(officeRoot) ? "/office" : "/work");
    if (spec.network) run.push("--network", spec.network);
    for (const n of envFlags(env, process.env)) run.push("-e", n);
    for (const extra of spec.args || []) run.push(String(extra));
    run.push(image, "claude", ...mapped);
    return {
      file: "docker", args: run,
      // No shell: docker is a real executable everywhere, and an argv array has
      // no quoting to get wrong.
      options: { cwd, shell: false, env },
      describe: "docker:" + image,
    };
  }

  if (kind === "ssh") {
    const host = String(spec.host || "").trim();
    if (!host) throw new Error("ssh backend has no host set");
    const remoteOffice = String(spec.officeDir || "").trim();
    if (!remoteOffice) {
      throw new Error(
        "ssh backend needs officeDir — the path to the office checkout ON THAT " +
        "machine. Without it the run loses --settings, which is what installs " +
        "the permission broker, and nothing would be watching the agent");
    }
    const remoteWork = String(spec.dir || "").trim() || remoteOffice;
    const maps = [
      { from: officeRoot, to: remoteOffice },
      { from: cwd, to: remoteWork },
    ];
    const { args: mapped, missed } = remapArgs(argv, maps);
    if (missed.length) {
      throw new Error("ssh backend cannot place " + missed.join(", ") +
        " on " + host + " — it is outside the office root and the working directory");
    }
    // One shell string for the remote side: cd, then claude with its arguments,
    // each quoted for that shell. Keys travel through ssh's own env forwarding
    // only if the remote sshd allows it, so name them in the command instead.
    const assigns = envFlags(env, process.env)
      .filter((n) => env[n] !== undefined && env[n] !== null)
      .map((n) => n + "=" + shq(env[n]));
    const remote = "cd " + shq(remoteWork) + " && " +
      assigns.concat(["claude"]).concat(mapped.map(shq)).join(" ");
    const args = [];
    if (spec.identity) args.push("-i", String(spec.identity));
    if (spec.port) args.push("-p", String(spec.port));
    args.push("-o", "BatchMode=yes", host, remote);
    return {
      file: "ssh", args,
      options: { cwd, shell: false, env },
      describe: "ssh:" + host,
    };
  }

  throw new Error("unknown execution backend kind: " + kind);
}

// Which backend a run should use: the agent's own choice, else the office
// default, else local. An unknown name falls back to local rather than failing
// the run — a typo in a setting should not stop the office working.
function pick(reg, agent) {
  const backends = (reg && reg.execBackends) || {};
  const a = (reg && reg.agents && reg.agents[agent]) || {};
  const name = a.backend || (reg && reg.execBackend) || "";
  if (!name || name === "local") return { name: "local", spec: { kind: "local" } };
  const spec = backends[name];
  if (!spec) return { name: "local", spec: { kind: "local" }, unknown: name };
  return { name, spec };
}

module.exports = { plan, pick, remapPath, remapArgs, shq, envFlags };
