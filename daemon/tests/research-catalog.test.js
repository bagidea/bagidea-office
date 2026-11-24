"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const {
  COMMIT_URL, RAW_URL, parseReadme, changesSince, fetchText, refreshCatalog, atomicWrite,
} = require("../../scripts/research-catalog");

const SHA = "a".repeat(40);
const FIXED_TIME = "2026-09-26T02:00:00.000Z";
const now = () => new Date(FIXED_TIME);
const fullReadme = () => "Updated April 29, 2026.\n" + Array.from({ length: 14 }, (_, index) =>
  `### 🧠 ${index + 1}. Category ${index + 1}\n#### Local tools\n- **[Tool ${index + 1}](https://github.com/example/tool-${index + 1})** - description\n`).join("\n");

async function files(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "office-research-catalog-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return { directory, input: path.join(directory, "README.md"), output: path.join(directory, "catalog.json") };
}

test("catalog parser captures combined links, category membership and URL parentheses without badges or footer links", () => {
  const parsed = parseReadme([
    "## Contents", "- [1. Models](#models)", "- [outside](https://example.com/outside)",
    "### 🧬 1. Core Frameworks & Libraries", "#### Deep Learning Frameworks",
    "- **[JAX](https://github.com/jax-ml/jax)** ![GitHub stars](https://img.shields.io/github/stars/jax-ml/jax) + **[Flax](https://github.com/google/flax)** - words",
    "- [![badge](https://img.shields.io/badge/a)](https://example.com/badge) **[Tool (local)](https://example.com/tool_(local))**",
    "- **[JAX](https://github.com/jax-ml/jax)** - duplicate in same section",
    "- [unsafe](javascript:alert(1)) [credential](https://secret@example.com/project)",
    "```markdown", "- [code example](https://example.com/ignored)", "```",
    "#### Other frameworks", "- **[JAX](https://github.com/jax-ml/jax)**",
    "### 📚 14. Resources & Learning", "- [Guide](https://example.com/guide \"A title\")",
    "## License", "- [License](https://example.com/license)",
  ].join("\n"));
  assert.deepEqual(parsed.entries.map((entry) => entry.name), ["JAX", "Flax", "Tool (local)", "JAX", "Guide"]);
  assert.equal(parsed.entries[2].url, "https://example.com/tool_(local)");
  assert.equal(parsed.entries[3].subcategory, "Other frameworks");
  assert.equal(parsed.entries[4].subcategory, null);
  assert.deepEqual(parsed.categories.map(({ number, count }) => [number, count]), [[1, 4], [14, 1]]);
});

test("catalog parser rejects missing entries and duplicate category numbers", () => {
  assert.throws(() => parseReadme("<html>Unavailable</html>"), /no recognizable/);
  assert.throws(() => parseReadme("### 1. Tools\n- [one](https://example.com/one)\n### 1. More tools"), /Duplicate/);
});

test("catalog differences preserve separate category memberships and identify removals", () => {
  const old = parseReadme("### 1. Tools\n#### Local\n- [A](https://example.com/a)\n- [B](https://example.com/b)").entries;
  const next = [old[0], { ...old[1], subcategory: "Server" }];
  const changes = changesSince({ checkedAt: "yesterday", entries: old }, next);
  assert.equal(changes.comparedWithCheckedAt, "yesterday");
  assert.deepEqual(changes.added, [next[1]]);
  assert.deepEqual(changes.removed, [old[1]]);
});

test("offline import marks provenance as local input and does not access the network", async (t) => {
  const { input, output } = await files(t);
  await fs.writeFile(input, "### 1. Tools\n- [A](https://example.com/a)");
  const result = await refreshCatalog({ input, output, now, fetcher: () => { throw new Error("unexpected network"); } });
  assert.equal(result.source.commitStatus, "local-input");
  assert.equal(result.source.commitSha, null);
  assert.equal(result.checkedAt, FIXED_TIME);
  assert.equal(result.source.contentSha256.length, 64);
  assert.equal(result.changes.added.length, 1);
  assert.deepEqual(JSON.parse(await fs.readFile(output, "utf8")), result);
  const repeat = await refreshCatalog({ input, output, now });
  assert.equal(repeat.changes.added.length, 0);
  assert.equal(repeat.changes.removed.length, 0);
});

test("live import pins the README to the metadata commit and requires all fourteen categories", async (t) => {
  const { output } = await files(t);
  const calls = [];
  const result = await refreshCatalog({ output, now, fetcher: async (url) => {
    calls.push(url);
    return url === COMMIT_URL ? JSON.stringify([{ sha: SHA, commit: { committer: { date: "2026-04-29T12:00:00Z" } } }]) : fullReadme();
  } });
  assert.deepEqual(calls, [COMMIT_URL, `https://raw.githubusercontent.com/f2dac/awesome-opensource-ai/${SHA}/README.md`]);
  assert.equal(result.source.commitSha, SHA);
  assert.equal(result.source.commitStatus, "verified");
  assert.equal(result.source.declaredUpdate, "April 29, 2026");
  assert.equal(result.categories.length, 14);
});

test("failed or missing commit metadata is explicit while successful README content remains discoverable", async (t) => {
  const { output } = await files(t);
  for (const metadata of ["[]", "{}", "not json", JSON.stringify([{ sha: "bad" }])]) {
    const calls = [];
    const result = await refreshCatalog({ output, now, fetcher: async (url) => {
      calls.push(url);
      return url === COMMIT_URL ? metadata : fullReadme();
    } });
    assert.equal(result.source.commitSha, null);
    assert.equal(result.source.commitStatus, "unavailable");
    assert.ok(result.source.commitError);
    assert.deepEqual(calls, [COMMIT_URL, RAW_URL]);
  }
  const result = await refreshCatalog({ output, now, fetcher: async (url) => {
    if (url === COMMIT_URL) throw new Error("rate limited");
    return fullReadme();
  } });
  assert.equal(result.source.commitError, "rate limited");
});

test("network failure and incomplete source never overwrite or freshen a previous cache", async (t) => {
  const { input, output } = await files(t);
  await fs.writeFile(input, fullReadme());
  await refreshCatalog({ input, output, now });
  const before = await fs.readFile(output, "utf8");
  await assert.rejects(refreshCatalog({ output, now, fetcher: async () => { throw new Error("offline"); } }), /offline/);
  assert.equal(await fs.readFile(output, "utf8"), before);
  await assert.rejects(refreshCatalog({ output, now, fetcher: async (url) => url === COMMIT_URL ? "[]" : "### 1. Tools\n- [A](https://example.com/a)" }), /14 non-empty/);
  assert.equal(await fs.readFile(output, "utf8"), before);
});

test("malformed previous cache is preserved and reported instead of being silently replaced", async (t) => {
  const { input, output } = await files(t);
  await fs.writeFile(input, fullReadme());
  await fs.writeFile(output, "{broken");
  await assert.rejects(refreshCatalog({ input, output, now }), /Previous catalog cannot be read/);
  assert.equal(await fs.readFile(output, "utf8"), "{broken");
});

test("atomic writes replace existing files and leave no temporary files", async (t) => {
  const { directory, output } = await files(t);
  await atomicWrite(output, "old");
  await atomicWrite(output, "new");
  assert.equal(await fs.readFile(output, "utf8"), "new");
  assert.deepEqual(await fs.readdir(directory), ["catalog.json"]);
});

test("fetch only permits HTTPS GitHub hosts and validates each redirect", async () => {
  let calls = 0;
  const redirect = async () => { calls++; return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } }); };
  for (const url of ["http://github.com/a", "https://evil.example/a", "https://github.com.evil.example/a", "https://token@github.com/a", "https://github.com:444/a"]) {
    await assert.rejects(fetchText(url, { fetchImpl: redirect }), /untrusted/);
  }
  assert.equal(calls, 0);
  await assert.rejects(fetchText(RAW_URL, { fetchImpl: redirect }), /untrusted/);
  assert.equal(calls, 1);
  let redirects = 0;
  await assert.rejects(fetchText(RAW_URL, { fetchImpl: async () => {
    redirects++; return new Response(null, { status: 302, headers: { location: RAW_URL } });
  } }), /redirect limit/);
  assert.equal(redirects, 4);
});

test("fetch bounds declared and streamed response sizes, including chunked responses", async () => {
  await assert.rejects(fetchText(RAW_URL, { maxBytes: 4, fetchImpl: async () => new Response("hello", { headers: { "content-length": "5" } }) }), /size limit/);
  await assert.rejects(fetchText(RAW_URL, { maxBytes: 4, fetchImpl: async () => new Response("hello") }), /size limit/);
  await assert.rejects(fetchText(RAW_URL, { fetchImpl: async () => new Response("unavailable", { status: 503 }) }), /HTTP 503/);
  assert.equal(await fetchText(RAW_URL, { fetchImpl: async () => new Response("hello") }), "hello");
});

test("fetch aborts on its bounded deadline", async () => {
  await assert.rejects(fetchText(RAW_URL, { timeoutMs: 10, fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
  }) }), /timed out/);
});
