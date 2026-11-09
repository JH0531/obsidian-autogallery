/**
 * Image dimensions that are known before the bitmap decodes.
 *
 * Both views have to lay a picture out before its pixels arrive: the reading
 * view because a block that is sized late collapses the section under the
 * reader, Live Preview because a gallery row that waits for every bitmap
 * paints once at natural width and then snaps into cells. Obsidian only
 * reports `naturalWidth`/`naturalHeight` after decode, and the per-note metric
 * cache in `image-metrics.js` is empty on the first open of a note, so the
 * ratio has to come from somewhere else.
 *
 * It comes from the file header. PNG, JPEG, GIF, WebP, BMP, AVIF and SVG all
 * carry the pixel size in their first few dozen bytes, and on desktop the
 * header can be read synchronously, which is what lets the very first layout
 * pass of a note be the final one. Mobile has no synchronous file API; there
 * the read is asynchronous and the layout is corrected when it lands.
 */
import { normalizeTarget } from "./image-runs.js";
import { imageMetricKey, linkMetricKey, rememberImageMetric, rememberLinkMetric } from "./image-metrics.js";

/** Enough for a JPEG's frame header and an SVG's root element. */
const HEADER_BYTES = 128 * 1024;
/** A file this large is not worth a whole-file fallback read. */
const MAX_ASYNC_BYTES = 48 * 1024 * 1024;

/** Vault path -> `{ width, height }`, filled by a header read. */
const sizes = new Map();
/** Vault paths whose header could not be read; never retried in a session. */
const failed = new Set();
const inflight = new Set();
const listeners = new Set();
let dirty = false;

/** Notified once when an asynchronously probed size becomes available. */
export function onImageSizeResolved(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify() {
  for (const listener of [...listeners]) {
    try { listener(); } catch { /* a listener must never break the probe */ }
  }
}

/** Vault path -> known pixel size, or null while it is still unknown. */
export function imageSizeFor(path) {
  return sizes.get(path) ?? null;
}

export function hasImageSize(path) {
  return sizes.has(path);
}

export function markImageSizesDirty() {
  dirty = true;
}

export function takeImageSizesDirty() {
  const value = dirty;
  dirty = false;
  return value;
}

export function serializeImageSizes() {
  return Object.fromEntries(sizes);
}

/**
 * Restore a persisted cache. Entries are trusted only when they describe a
 * positive pixel box; a stale entry is corrected the first time the file is
 * probed again, and the metric it seeded is overwritten by the decode.
 */
export function hydrateImageSizes(raw) {
  if (!raw || typeof raw !== "object") return;
  for (const [path, value] of Object.entries(raw)) {
    const width = Number(value?.width);
    const height = Number(value?.height);
    if (typeof path !== "string" || !(width > 0) || !(height > 0)) continue;
    sizes.set(path, { width, height });
  }
}

function remember(path, width, height) {
  const w = Math.round(Number(width));
  const h = Math.round(Number(height));
  if (!path || !(w > 0) || !(h > 0)) return null;
  sizes.set(path, { width: w, height: h });
  dirty = true;
  return { width: w, height: h };
}

/* ------------------------------------------------------------------ *
 * Header parsing
 * ------------------------------------------------------------------ */

function u16be(bytes, at) { return (bytes[at] << 8) | bytes[at + 1]; }
function u16le(bytes, at) { return bytes[at] | (bytes[at + 1] << 8); }
function u32be(bytes, at) {
  return ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0;
}
function u32le(bytes, at) {
  return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
}
function ascii(bytes, at, length) {
  let text = "";
  for (let index = 0; index < length; index += 1) {
    const code = bytes[at + index];
    if (code === undefined) return text;
    text += String.fromCharCode(code);
  }
  return text;
}

const JPEG_SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

/**
 * Pixel size from an image header, or null when the format is unknown or the
 * header is truncated. Only the size is read: nothing here decodes pixels, so
 * it stays cheap enough to run for every image of a note on open.
 */
export function parseImageHeader(bytes) {
  if (!bytes || bytes.length < 12) return null;
  // PNG: the IHDR chunk is always the first one.
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  // JPEG: walk the segment chain until a start-of-frame carries the size.
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let at = 2;
    while (at + 9 < bytes.length) {
      if (bytes[at] !== 0xff) { at += 1; continue; }
      let marker = bytes[at + 1];
      // Fill bytes: a marker may be preceded by any number of 0xff.
      while (marker === 0xff && at + 2 < bytes.length) { at += 1; marker = bytes[at + 1]; }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { at += 2; continue; }
      const length = u16be(bytes, at + 2);
      if (length < 2) return null;
      if (JPEG_SOF.has(marker)) {
        return { width: u16be(bytes, at + 7), height: u16be(bytes, at + 5) };
      }
      at += 2 + length;
    }
    return null;
  }
  const head6 = ascii(bytes, 0, 6);
  if (head6 === "GIF87a" || head6 === "GIF89a") {
    return { width: u16le(bytes, 6), height: u16le(bytes, 8) };
  }
  if (ascii(bytes, 0, 2) === "BM" && bytes.length >= 26) {
    return { width: Math.abs(u32le(bytes, 18) | 0), height: Math.abs((u32le(bytes, 22) | 0)) };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    const chunk = ascii(bytes, 12, 4);
    if (chunk === "VP8 ") return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
    if (chunk === "VP8L") {
      const bits = u32le(bytes, 21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8X") {
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      return { width, height };
    }
    return null;
  }
  // AVIF / HEIC: the `ispe` box carries the display size.
  if (ascii(bytes, 4, 4) === "ftyp") {
    const limit = Math.min(bytes.length - 12, 4096);
    for (let at = 0; at < limit; at += 1) {
      if (bytes[at] !== 0x69 || ascii(bytes, at, 4) !== "ispe") continue;
      return { width: u32be(bytes, at + 8), height: u32be(bytes, at + 12) };
    }
    return null;
  }
  // SVG is text: read the root element's declared box.
  if (bytes[0] === 0x3c) {
    let text = "";
    for (let index = 0; index < Math.min(bytes.length, 4096); index += 1) text += String.fromCharCode(bytes[index]);
    return parseSvgSize(text);
  }
  return null;
}

function parseSvgSize(text) {
  const root = /<svg\b[^>]*>/i.exec(text);
  if (!root) return null;
  const attribute = (name) => {
    const match = new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i").exec(root[0]);
    return match ? Number.parseFloat(match[1]) : null;
  };
  const width = attribute("width");
  const height = attribute("height");
  if (width > 0 && height > 0) return { width, height };
  const viewBox = /\bviewBox\s*=\s*["']\s*([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)[\s,]+([-\d.]+)/i.exec(root[0]);
  if (!viewBox) return null;
  const boxWidth = Number.parseFloat(viewBox[3]);
  const boxHeight = Number.parseFloat(viewBox[4]);
  return boxWidth > 0 && boxHeight > 0 ? { width: boxWidth, height: boxHeight } : null;
}

/* ------------------------------------------------------------------ *
 * File access
 * ------------------------------------------------------------------ */

function nodeRequire() {
  const scope = globalThis;
  const loader = scope.require ?? scope.window?.require;
  if (typeof loader !== "function") return null;
  try { return loader("fs"); } catch { return null; }
}

function fullPathFor(app, path) {
  const adapter = app?.vault?.adapter;
  try { return adapter?.getFullPath?.(path) ?? null; } catch { return null; }
}

function readHeaderSync(app, path) {
  const fs = nodeRequire();
  const fullPath = fullPathFor(app, path);
  if (!fs?.openSync || !fullPath || typeof Buffer !== "function") return null;
  let handle = null;
  try {
    handle = fs.openSync(fullPath, "r");
    const total = fs.fstatSync(handle).size;
    const length = Math.min(total, HEADER_BYTES);
    if (!(length > 0)) return null;
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, 0);
    return parseImageHeader(buffer);
  } catch {
    return null;
  } finally {
    if (handle !== null) { try { fs.closeSync(handle); } catch { /* already closed */ } }
  }
}

async function readHeaderAsync(app, path) {
  const adapter = app?.vault?.adapter;
  if (!adapter?.readBinary) return null;
  try {
    if (adapter.stat) {
      const stat = await adapter.stat(path);
      if (stat?.size > MAX_ASYNC_BYTES) return null;
    }
    const buffer = await adapter.readBinary(path);
    return parseImageHeader(new Uint8Array(buffer));
  } catch {
    return null;
  }
}

/**
 * Pixel size of a vault file, from the cache when possible. A synchronous
 * header read is attempted first: the first layout pass of a note then has
 * every ratio it needs, which is what makes the takeover seamless. When only
 * the asynchronous path is available the result arrives later and the caller
 * is notified through `onImageSizeResolved`.
 */
export function ensureImageSize(app, path) {
  if (!path) return null;
  const cached = sizes.get(path);
  if (cached) return cached;
  if (failed.has(path) || inflight.has(path)) return null;
  const sync = readHeaderSync(app, path);
  if (sync?.width > 0 && sync?.height > 0) {
    // Synchronous sizes need no notification: the caller seeds the metric and
    // lays the note out in the same task, so the first pass is already final.
    return remember(path, sync.width, sync.height);
  }
  inflight.add(path);
  readHeaderAsync(app, path).then((async) => {
    inflight.delete(path);
    if (async?.width > 0 && async?.height > 0) {
      remember(path, async.width, async.height);
      notify();
      return;
    }
    // A format this module cannot read still decodes fine; remember the miss
    // so the note is not re-probed on every layout pass.
    failed.add(path);
  });
  return null;
}

/* ------------------------------------------------------------------ *
 * Note priming
 * ------------------------------------------------------------------ */

const WIKI_EMBED = /!\[\[([^\]\n]+)\]\]/g;
const MARKDOWN_EMBED = /!\[[^\]\n]*\]\(([^)\n]+)\)/g;

/**
 * Every image reference of a note, in document order. Standalone image lines
 * are not enough: a picture inside a list item or a callout is laid out by the
 * plugin too, and Live Preview needs its ratio just as much.
 *
 * Each entry lists the spellings the two views look the reference up by — the
 * raw link text Live Preview derives from the source line, and the normalised
 * embed target the reading view reads off the rendered DOM.
 */
export function collectImageTargets(text) {
  const targets = [];
  const source = String(text ?? "");
  for (const match of source.matchAll(WIKI_EMBED)) {
    const parts = match[1].split("|")[0].split("#");
    targets.push(parts[0].trim(), parts[0].trim() ? `${parts[0].trim()}#${parts.slice(1).join("#")}` : "");
  }
  for (const match of source.matchAll(MARKDOWN_EMBED)) {
    const raw = match[1].trim();
    const head = raw.split(/\s+/)[0];
    targets.push(raw, head);
  }
  return targets.filter(Boolean);
}

function isRemote(target) {
  return /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target) || target.startsWith("#");
}

/**
 * Seed the per-note metric cache with every image size the note's headers
 * report. Callers pass the source text because that is the only place where
 * the reference targets still exist: the rendered DOM reports resolved
 * resource URLs, and a block the virtualiser has detached has no DOM at all.
 */
export function primeNoteImageSizes(app, notePath, sourceText) {
  if (!app?.metadataCache || !notePath) return 0;
  let primed = 0;
  for (const raw of collectImageTargets(sourceText)) {
    if (!raw || isRemote(raw)) continue;
    const target = normalizeTarget(raw);
    if (!target || isRemote(target)) continue;
    const file = app.metadataCache.getFirstLinkpathDest?.(target, notePath);
    if (!file?.path || file.children) continue;
    const size = ensureImageSize(app, file.path);
    if (!size) continue;
    // Live Preview keys by the link text exactly as the note wrote it, the
    // reading view by the normalised embed target. Both are seeded so neither
    // view depends on which form it happens to look up.
    rememberImageMetric(imageMetricKey(notePath, raw), size.width, size.height);
    rememberLinkMetric(linkMetricKey(notePath, target), size.width, size.height);
    if (raw !== target) {
      rememberImageMetric(imageMetricKey(notePath, target), size.width, size.height);
      rememberLinkMetric(linkMetricKey(notePath, raw), size.width, size.height);
    }
    primed += 1;
  }
  return primed;
}
