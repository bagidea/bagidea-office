"use strict";

// Small, deliberately strict ZIP reader/writer for portable office bundles. It
// never extracts files itself: callers choose the destination after validation.
const { inflateRawSync } = require("node:zlib");
const { TextDecoder } = require("node:util");

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 2000;
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const CP437 = "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});

function fail(message) { throw new Error("Invalid office ZIP: " + message); }
function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function bounds(buffer, offset, size, end = buffer.length) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > end) fail("truncated or out-of-bounds record");
}
function readName(bytes, flags) {
  if (!(flags & 0x800)) return Array.from(bytes, (b) => b < 128 ? String.fromCharCode(b) : CP437[b - 128]).join("");
  try { return UTF8.decode(bytes); } catch { fail("filename is not valid UTF-8"); }
}
function pathKey(name) { return name.normalize("NFC").toUpperCase(); }
function safeName(name) {
  if (typeof name !== "string" || !name || /^[\/]/.test(name) || /[\\\x00-\x1f\x7f<>:"|?*]/.test(name)) fail("unsafe entry path");
  const directory = name.endsWith("/");
  const clean = directory ? name.slice(0, -1) : name;
  const parts = clean.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === ".." || /[. ]$/.test(part)) fail("unsafe entry path");
    const base = part.split(".")[0].replace(/[. ]+$/, "");
    if (/^(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(base)) fail("reserved Windows entry path");
  }
  return { directory, key: pathKey(clean), parts };
}
function checkPaths(entries) {
  const paths = new Map();
  for (const entry of entries) {
    const p = safeName(entry.name);
    if (paths.has(p.key)) fail("duplicate entry path");
    paths.set(p.key, p.directory);
    entry.directory = p.directory;
  }
  for (const entry of entries) {
    const parts = entry.name.replace(/\/$/, "").split("/");
    for (let n = 1; n < parts.length; n++) {
      if (paths.get(pathKey(parts.slice(0, n).join("/"))) === false) fail("a file is used as a parent directory");
    }
  }
}
function checkExtra(buffer, offset, size) {
  const end = offset + size;
  bounds(buffer, offset, size);
  while (offset < end) {
    bounds(buffer, offset, 4, end);
    const id = buffer.readUInt16LE(offset), length = buffer.readUInt16LE(offset + 2);
    if (id === 0x0001) fail("ZIP64 is not supported");
    bounds(buffer, offset + 4, length, end);
    offset += 4 + length;
  }
}
function checkMethod(flags, method, version) {
  if (version > 20) fail("unsupported ZIP version (including ZIP64)");
  if (flags & ~0x080e) fail("encrypted or unsupported ZIP flags");
  if (method !== 0 && method !== 8) fail("unsupported compression method");
  if (method === 0 && (flags & 6)) fail("invalid stored ZIP flags");
}

function encode(entries) {
  if (!Array.isArray(entries) || entries.length > MAX_ENTRIES) fail("too many entries");
  const files = entries.map((entry) => {
    if (!entry || (typeof entry.data !== "string" && !Buffer.isBuffer(entry.data))) fail("entry data must be a Buffer or string");
    safeName(entry.name);
    const nameBytes = Buffer.from(entry.name, "utf8");
    // A lone JS surrogate would silently be changed by Buffer.from.
    if (UTF8.decode(nameBytes) !== entry.name || nameBytes.length > 0xffff) fail("invalid filename");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    if (data.length > MAX_ENTRY_BYTES) fail("entry exceeds size limit");
    return { name: entry.name, nameBytes, data };
  });
  checkPaths(files);
  let total = 0, archiveSize = 22;
  for (const file of files) {
    if (file.directory && file.data.length) fail("directory entry has data");
    total += file.data.length;
    archiveSize += 30 + 46 + file.nameBytes.length * 2 + file.data.length;
  }
  if (total > MAX_TOTAL_BYTES) fail("total uncompressed size exceeds limit");
  if (archiveSize > MAX_ARCHIVE_BYTES) fail("archive exceeds size limit");
  const local = [], central = [];
  let offset = 0, centralSize = 0;
  for (const file of files) {
    const crc = crc32(file.data), nameLength = file.nameBytes.length;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(0x21, 12); // 1980-01-01, valid even for strict unzip tools.
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(file.data.length, 18);
    header.writeUInt32LE(file.data.length, 22);
    header.writeUInt16LE(nameLength, 26);
    local.push(header, file.nameBytes, file.data);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50, 0);
    record.writeUInt16LE(0x0314, 4); // Unix, ZIP 2.0.
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(0x800, 8);
    record.writeUInt16LE(0x21, 14);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(file.data.length, 20);
    record.writeUInt32LE(file.data.length, 24);
    record.writeUInt16LE(nameLength, 28);
    record.writeUInt32LE(((file.directory ? 0x41ed : 0x81a4) * 0x10000 + (file.directory ? 0x10 : 0)) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    central.push(record, file.nameBytes);
    offset += header.length + nameLength + file.data.length;
    centralSize += record.length + nameLength;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end], archiveSize);
}

function decode(buffer) {
  if (!Buffer.isBuffer(buffer)) fail("archive must be a Buffer");
  if (buffer.length > MAX_ARCHIVE_BYTES) fail("archive exceeds size limit");
  let end = -1;
  for (let n = buffer.length - 22; n >= Math.max(0, buffer.length - 22 - 0xffff); n--) {
    if (buffer.readUInt32LE(n) === 0x06054b50 && n + 22 + buffer.readUInt16LE(n + 20) === buffer.length) { end = n; break; }
  }
  if (end < 0) fail("end record is missing or truncated");
  if (buffer.readUInt16LE(end + 4) || buffer.readUInt16LE(end + 6)) fail("multidisk ZIP is not supported");
  const count = buffer.readUInt16LE(end + 10), centralSize = buffer.readUInt32LE(end + 12), centralOffset = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) fail("ZIP64 is not supported");
  if (count !== buffer.readUInt16LE(end + 8)) fail("multidisk entry count mismatch");
  if (count > MAX_ENTRIES) fail("too many entries");
  if (centralOffset + centralSize !== end) fail("invalid central directory bounds");
  const entries = [];
  let cursor = centralOffset, total = 0;
  for (let n = 0; n < count; n++) {
    bounds(buffer, cursor, 46, end);
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) fail("invalid central directory record");
    const version = buffer.readUInt16LE(cursor + 6), flags = buffer.readUInt16LE(cursor + 8), method = buffer.readUInt16LE(cursor + 10);
    checkMethod(flags, method, version);
    const crc = buffer.readUInt32LE(cursor + 16), compressed = buffer.readUInt32LE(cursor + 20), size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28), extraLength = buffer.readUInt16LE(cursor + 30), commentLength = buffer.readUInt16LE(cursor + 32);
    const disk = buffer.readUInt16LE(cursor + 34), attrs = buffer.readUInt32LE(cursor + 38), offset = buffer.readUInt32LE(cursor + 42);
    if (disk) fail("multidisk ZIP is not supported");
    if (compressed === 0xffffffff || size === 0xffffffff || offset === 0xffffffff) fail("ZIP64 is not supported");
    if (size > MAX_ENTRY_BYTES) fail("entry exceeds size limit");
    total += size;
    if (total > MAX_TOTAL_BYTES) fail("total uncompressed size exceeds limit");
    if (method === 0 && compressed !== size) fail("stored entry size mismatch");
    bounds(buffer, cursor + 46, nameLength + extraLength + commentLength, end);
    const nameBytes = buffer.subarray(cursor + 46, cursor + 46 + nameLength), name = readName(nameBytes, flags);
    const { directory } = safeName(name), type = (attrs >>> 16) & 0xf000;
    if ((type && type !== 0x8000 && type !== 0x4000) || (attrs & 8)) fail("symlinks and nonregular entries are not supported");
    if ((type === 0x4000 || (attrs & 0x10)) && !directory) fail("directory attributes do not match entry path");
    if (type === 0x8000 && directory) fail("file attributes do not match entry path");
    if (directory && size) fail("directory entry has data");
    checkExtra(buffer, cursor + 46 + nameLength, extraLength);
    entries.push({ name, nameBytes, flags, method, version, crc, compressed, size, offset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== end) fail("central directory entry count or size mismatch");
  checkPaths(entries);
  const ranges = [];
  // Validate every local record before spending time or memory inflating data.
  for (const entry of entries) {
    const p = entry.offset;
    bounds(buffer, p, 30, centralOffset);
    if (buffer.readUInt32LE(p) !== 0x04034b50) fail("invalid local file header");
    if (buffer.readUInt16LE(p + 4) !== entry.version || buffer.readUInt16LE(p + 6) !== entry.flags || buffer.readUInt16LE(p + 8) !== entry.method) fail("local and central metadata mismatch");
    const nameLength = buffer.readUInt16LE(p + 26), extraLength = buffer.readUInt16LE(p + 28);
    bounds(buffer, p + 30, nameLength + extraLength + entry.compressed, centralOffset);
    if (!buffer.subarray(p + 30, p + 30 + nameLength).equals(entry.nameBytes)) fail("local and central filename mismatch");
    checkExtra(buffer, p + 30 + nameLength, extraLength);
    const descriptor = !!(entry.flags & 8);
    for (const [field, value] of [[14, entry.crc], [18, entry.compressed], [22, entry.size]]) {
      const localValue = buffer.readUInt32LE(p + field);
      if (localValue !== value && !(descriptor && localValue === 0)) fail("local and central size or checksum mismatch");
    }
    entry.dataStart = p + 30 + nameLength + extraLength;
    let rangeEnd = entry.dataStart + entry.compressed;
    if (descriptor) {
      const matches = (start) => start + 12 <= centralOffset && buffer.readUInt32LE(start) === entry.crc && buffer.readUInt32LE(start + 4) === entry.compressed && buffer.readUInt32LE(start + 8) === entry.size;
      if (rangeEnd + 16 <= centralOffset && buffer.readUInt32LE(rangeEnd) === 0x08074b50 && matches(rangeEnd + 4)) rangeEnd += 16;
      else if (matches(rangeEnd)) rangeEnd += 12;
      else fail("invalid data descriptor");
    }
    ranges.push([p, rangeEnd]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let localEnd = 0;
  for (const [start, stop] of ranges) {
    if (start !== localEnd) fail("overlapping entries or unexpected data between ZIP records");
    localEnd = stop;
  }
  if (localEnd !== centralOffset) fail("unexpected data before central directory");
  const files = [];
  for (const entry of entries) {
    const compressed = buffer.subarray(entry.dataStart, entry.dataStart + entry.compressed);
    let data;
    if (entry.method === 0) data = Buffer.from(compressed);
    else {
      try {
        const result = inflateRawSync(compressed, { maxOutputLength: Math.max(1, entry.size), info: true });
        if (result.engine.bytesWritten !== compressed.length) fail("unexpected trailing compressed data");
        data = result.buffer;
      } catch (error) { fail("invalid or oversized deflate data: " + error.message); }
    }
    if (data.length !== entry.size) fail("uncompressed size mismatch");
    if (crc32(data) !== entry.crc) fail("checksum mismatch");
    if (!entry.directory) files.push({ name: entry.name, data });
  }
  return files;
}

module.exports = { encode, decode, MAX_ARCHIVE_BYTES, MAX_TOTAL_BYTES, MAX_ENTRY_BYTES, MAX_ENTRIES };
