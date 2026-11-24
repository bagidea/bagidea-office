#!/usr/bin/env node
"use strict";

// Discovery data only. Remote Markdown is parsed, never rendered or executed.
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const SOURCE_URL = "https://github.com/f2dac/awesome-opensource-ai/blob/main/README.md";
const RAW_URL = "https://raw.githubusercontent.com/f2dac/awesome-opensource-ai/main/README.md";
const COMMIT_URL = "https://api.github.com/repos/f2dac/awesome-opensource-ai/commits?path=README.md&per_page=1";
const DEFAULT_OUTPUT = path.join(__dirname, "..", "docs", "research", "catalog.json");
const MAX_BYTES = 2 * 1024 * 1024;
const TRUSTED_HOSTS = new Set(["raw.githubusercontent.com", "api.github.com", "github.com"]);

function trustedUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || !TRUSTED_HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Catalog fetch refused an untrusted URL");
  }
  return url;
}

// One deadline covers redirects and body streaming. Content-Length is only an
// early rejection; the byte counter also bounds chunked/decompressed responses.
async function fetchText(url, { fetchImpl = globalThis.fetch, timeoutMs = 15000, maxBytes = MAX_BYTES } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("Catalog refresh requires Node.js 18 or newer");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Catalog fetch timed out")), timeoutMs);
  let response;
  try {
    let current = trustedUrl(url);
    for (let redirects = 0; ; redirects++) {
      response = await fetchImpl(current.href, {
        redirect: "manual", signal: controller.signal,
        headers: { "User-Agent": "BagIdeaOffice-research-catalog", "Accept": "application/vnd.github+json, text/plain" },
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        if (redirects >= 3) throw new Error("Catalog fetch exceeded redirect limit");
        const location = response.headers.get("location");
        if (!location) throw new Error("Catalog redirect has no destination");
        current = trustedUrl(new URL(location, current).href);
        continue;
      }
      if (!response.ok) throw new Error(`Catalog fetch returned HTTP ${response.status}`);
      if (Number(response.headers.get("content-length")) > maxBytes) throw new Error("Catalog response exceeds size limit");
      if (!response.body) throw new Error("Catalog response has no body");
      const chunks = [];
      let bytes = 0;
      const reader = response.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > maxBytes) throw new Error("Catalog response exceeds size limit");
          chunks.push(Buffer.from(value));
        }
      } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
      }
      return Buffer.concat(chunks).toString("utf8");
    }
  } finally {
    clearTimeout(timer);
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}

function cleanName(value) {
  return value.replace(/<[^>]*>/g, "").replace(/\\([\\`*{}[\]()#+.!_>-])/g, "$1").replace(/[*`]/g, "").trim();
}

// This deliberately supports the source's inline Markdown links, including
// balanced URL parentheses and multiple projects per bullet (JAX + Flax).
function inlineLinks(line) {
  const links = [];
  const start = /(?<!!)\[([^\[\]\n]+)\]\(/g;
  let match;
  while ((match = start.exec(line))) {
    let end = start.lastIndex;
    let depth = 1;
    for (; end < line.length && depth; end++) {
      if (line[end] === "\\") { end++; continue; }
      if (line[end] === "(") depth++;
      if (line[end] === ")") depth--;
    }
    if (depth) continue;
    const destination = line.slice(start.lastIndex, end - 1).trim();
    const urlText = destination.startsWith("<") ? destination.slice(1, destination.indexOf(">")) : destination.split(/\s+["']/)[0];
    start.lastIndex = end;
    try {
      const url = new URL(urlText);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) continue;
      if (url.hostname === "img.shields.io" || url.hostname === "shields.io" || url.hostname === "awesome.re") continue;
      const name = cleanName(match[1]);
      if (name) links.push({ name, url: url.href });
    } catch { /* Anchors, relative links and malformed destinations are not projects. */ }
  }
  return links;
}

function entryKey(entry) {
  return JSON.stringify([entry.category, entry.subcategory, entry.name, entry.url]);
}

function parseReadme(markdown) {
  const entries = [];
  const categories = [];
  const seen = new Set();
  let category = null;
  let categoryLevel = 0;
  let subcategory = null;
  let fence = null;
  for (const line of String(markdown).split(/\r?\n/)) {
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1][0];
      else if (fenceMatch[1][0] === fence) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
    if (heading) {
      const numbered = heading[2].match(/^[^\d\p{L}]*([1-9]|1[0-4])\.\s+(.+)$/u);
      if (numbered) {
        const number = Number(numbered[1]);
        if (categories.some((item) => item.number === number)) throw new Error(`Duplicate catalog category ${number}`);
        category = { number, name: cleanName(numbered[2]), count: 0 };
        categories.push(category);
        categoryLevel = heading[1].length;
        subcategory = null;
      } else if (category && heading[1].length > categoryLevel) {
        subcategory = cleanName(heading[2]);
      } else {
        category = null;
        subcategory = null;
      }
      continue;
    }
    if (!category || !/^\s*[-*+]\s+/.test(line)) continue;
    // Discard images first, including a linked badge's outer Markdown link.
    const projectText = line.replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "");
    for (const link of inlineLinks(projectText)) {
      const entry = { ...link, category: category.name, subcategory };
      const key = entryKey(entry);
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push(entry);
      category.count++;
    }
  }
  if (!entries.length) throw new Error("README has no recognizable numbered catalog entries");
  return { entries, categories };
}

function changesSince(previous, entries) {
  const oldEntries = previous?.entries || [];
  const oldKeys = new Set(oldEntries.map(entryKey));
  const newKeys = new Set(entries.map(entryKey));
  return {
    comparedWithCheckedAt: previous?.checkedAt || null,
    added: entries.filter((entry) => !oldKeys.has(entryKey(entry))),
    removed: oldEntries.filter((entry) => !newKeys.has(entryKey(entry))),
  };
}

async function atomicWrite(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  try {
    await fs.writeFile(temporary, contents, { encoding: "utf8", flag: "wx" });
    await fs.rename(temporary, file);
  } finally {
    await fs.unlink(temporary).catch((error) => { if (error.code !== "ENOENT") throw error; });
  }
}

async function previousCatalog(output) {
  try {
    const previous = JSON.parse(await fs.readFile(output, "utf8"));
    if (previous.schemaVersion !== 1 || !Array.isArray(previous.entries) || !previous.checkedAt) throw new Error("Invalid previous catalog");
    return previous;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new Error(`Previous catalog cannot be read; preserved without changes: ${error.message}`);
  }
}

async function refreshCatalog({ input, output = DEFAULT_OUTPUT, fetcher = fetchText, now = () => new Date() } = {}) {
  const previous = await previousCatalog(output);
  const source = { url: SOURCE_URL, rawUrl: RAW_URL, commitSha: null, commitStatus: input ? "local-input" : "unavailable", commitCheckedAt: null };
  let markdown;
  if (input) {
    const stat = await fs.stat(input);
    if (stat.size > MAX_BYTES) throw new Error("Local README exceeds size limit");
    markdown = await fs.readFile(input, "utf8");
    if (Buffer.byteLength(markdown) > MAX_BYTES) throw new Error("Local README exceeds size limit");
    source.inputFile = path.basename(input);
  } else {
    try {
      const metadata = JSON.parse(await fetcher(COMMIT_URL, { maxBytes: 512 * 1024 }));
      const commit = Array.isArray(metadata) ? metadata[0] : null;
      if (!commit || !/^[0-9a-f]{40}$/i.test(commit.sha)) throw new Error("GitHub returned no valid README commit metadata");
      source.commitSha = commit.sha;
      source.commitStatus = "verified";
      source.commitCheckedAt = now().toISOString();
      source.commitDate = commit.commit?.committer?.date || null;
      source.rawUrl = `https://raw.githubusercontent.com/f2dac/awesome-opensource-ai/${commit.sha}/README.md`;
    } catch (error) {
      source.commitCheckedAt = now().toISOString();
      source.commitError = error.message;
    }
    // A successful README with missing metadata is usable for discovery, but
    // explicitly unverified. A content failure must never freshen the cache.
    markdown = await fetcher(source.rawUrl);
  }
  const parsed = parseReadme(markdown);
  if (!input && (parsed.categories.length !== 14 || parsed.categories.some((category) => !category.count))) {
    throw new Error("Source format changed or content is incomplete: expected 14 non-empty categories; previous catalog preserved");
  }
  source.contentSha256 = crypto.createHash("sha256").update(markdown).digest("hex");
  source.declaredUpdate = markdown.match(/Updated\s+([A-Za-z]+\s+\d{1,2},\s+\d{4})/)?.[1] || null;
  const catalog = {
    schemaVersion: 1, source, checkedAt: now().toISOString(),
    ...parsed, changes: changesSince(previous, parsed.entries),
  };
  await atomicWrite(output, `${JSON.stringify(catalog, null, 2)}\n`);
  return catalog;
}

async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === "--help" || argv[index] === "-h") {
      console.log("Usage: node scripts/research-catalog.js [--input localREADME.md] [--output catalog.json]\nRefreshes the f2dac discovery inventory. Does not verify project licenses, releases or production fitness.");
      return;
    }
    if (!["--input", "--output"].includes(argv[index]) || !argv[index + 1] || argv[index + 1].startsWith("--")) throw new Error(`Unknown or incomplete argument: ${argv[index]}`);
    options[argv[index].slice(2)] = path.resolve(argv[++index]);
  }
  const catalog = await refreshCatalog(options);
  console.log(`Discovery catalog: ${catalog.entries.length} entries in ${catalog.categories.length} categories; +${catalog.changes.added.length}/-${catalog.changes.removed.length}; checked ${catalog.checkedAt}; commit ${catalog.source.commitStatus}.`);
  if (catalog.source.commitError) console.error(`Commit metadata unavailable: ${catalog.source.commitError}`);
}

if (require.main === module) main().catch((error) => {
  console.error(`Catalog refresh failed; previous cache preserved: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { SOURCE_URL, RAW_URL, COMMIT_URL, DEFAULT_OUTPUT, MAX_BYTES, trustedUrl, fetchText, parseReadme, changesSince, atomicWrite, refreshCatalog, main };
