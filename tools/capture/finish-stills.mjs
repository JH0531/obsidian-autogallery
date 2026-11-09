#!/usr/bin/env node
// Assemble the captured chunks into one still per shot.
//
//   node tools/capture/finish-stills.mjs          # after `shoot-batch.mjs --force`
//
// Each shot is cropped to its section, not to the window: `shoot.js` writes one
// PNG per viewport and records the exact crop for each, so a section that
// continues below the fold is stitched instead of truncated. A 16px band of the
// theme background is added on both ends — no minimum height, no bottom filler,
// so short sections stay short.
//
// The still is encoded to WebP at q85 and written to
// media/<lang>/<theme>/stills/<id>.webp. The variant comes from the shot's own
// meta.json, so a frame can only land in the cell it was actually captured in.

import { readdirSync, readFileSync, statSync, unlinkSync, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveVault } from "./lib/vault.mjs";
import { STILL_EXT, stillRel, assertVariant } from "./lib/media.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = resolveVault();
const shotsDir = path.join(vault, ".cache", "shots");
const LIMIT = 1200 * 1024;
const QUALITY = 85;
const RETRY_QUALITY = 70;
const PAD = 16;
const WIDTH = 1500;

if (!existsSync(shotsDir)) { console.error("缺少 .cache/shots，先跑 shoot-batch"); process.exit(1); }

function magick(args) {
  return execFileSync("magick", args, { encoding: "utf8" });
}

function encodeWebp(source, target, quality) {
  // `-strip` drops the PNG chunk metadata ImageMagick carried over; method 6 is
  // the slowest and smallest of libwebp's compression levels.
  magick([source, "-strip", "-quality", String(quality), "-define", "webp:method=6", target]);
  return statSync(target).size;
}

const assembled = [];
const converted = [];
const oversized = [];
const skipped = [];

for (const id of readdirSync(shotsDir)) {
  const dir = path.join(shotsDir, id);
  const metaPath = path.join(dir, "meta.json");
  if (!existsSync(metaPath)) continue;
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  if (!meta.id || !meta.lang || !meta.theme) {
    skipped.push({ dir: id, reason: "meta 缺少 id/lang/theme（旧格式缓存）" });
    continue;
  }
  assertVariant(meta.lang, meta.theme);

  const crops = [];
  meta.parts.forEach((part, index) => {
    const source = path.join(dir, part.file);
    const target = path.join(dir, `crop${String(index).padStart(2, "0")}.png`);
    magick([source, "-crop", `${WIDTH}x${part.cropHeight}+0+${part.cropTop}`, "+repage", target]);
    crops.push(target);
  });

  const assembledFile = path.join(dir, "assembled.png");
  if (crops.length === 1) magick([crops[0], assembledFile]);
  else magick([...crops, "-append", assembledFile]);

  let [width, height] = magick(["identify", "-format", "%w %h", assembledFile]).trim().split(" ").map(Number);
  // The delivery width is fixed at 1500. A window that opened narrower than
  // 1200 CSS px would otherwise fail the whole batch on its first shot; scale
  // the assembled frame instead, and keep the aspect ratio.
  if (width !== WIDTH) {
    magick([assembledFile, "-resize", `${WIDTH}x`, assembledFile]);
    [width, height] = magick(["identify", "-format", "%w %h", assembledFile]).trim().split(" ").map(Number);
  }
  if (width !== WIDTH) throw new Error(`${meta.id}: 拼接宽度 ${width}，期望 ${WIDTH}`);

  // Sample the theme background outside the text column; both breathing bands
  // use the same colour so the frame looks like it belongs to the page.
  const color = magick([assembledFile, "-format", "%[pixel:p{4,4}]", "info:"]).trim();

  // Trim the tail the capture deliberately over-shot, but never below the
  // height the planner asked for: a dark image must not be mistaken for margin.
  const expected = Math.round((meta.contentCss ?? 800) * 1.25);
  const trimmed = (() => {
    try {
      const info = magick([assembledFile, "-fuzz", "1%", "-format", "%@", "info:"]).trim();
      const match = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(info);
      return match ? Number(match[4]) + Number(match[2]) : height;
    } catch {
      return height;
    }
  })();
  const targetHeight = Math.max(40, Math.min(height, Math.max(trimmed, expected)));

  const padded = path.join(dir, "padded.png");
  magick([
    assembledFile,
    "-crop", `${WIDTH}x${targetHeight}+0+0`, "+repage",
    "-gravity", "north", "-background", color, "-splice", `0x${PAD}`,
    "-gravity", "south", "-background", color, "-splice", `0x${PAD}`,
    padded
  ]);

  const rel = stillRel(meta.id, meta.lang, meta.theme);
  const out = path.join(vault, rel);
  mkdirSync(path.dirname(out), { recursive: true });
  // Write to a temp name first: the vault watcher can still hold the target open.
  const tmp = `${out}.tmp.${STILL_EXT}`;
  let bytes = encodeWebp(padded, tmp, QUALITY);
  if (bytes > LIMIT) {
    const retried = encodeWebp(padded, tmp, RETRY_QUALITY);
    converted.push({ id: meta.id, cell: `${meta.lang}/${meta.theme}`, before: bytes, after: retried });
    bytes = retried;
  }
  if (bytes > LIMIT) oversized.push({ id: meta.id, cell: `${meta.lang}/${meta.theme}`, bytes });
  if (existsSync(out)) unlinkSync(out);
  renameSync(tmp, out);

  // A stale frame in another container would shadow this one on the site.
  for (const stale of ["png", "jpg", "jpeg"]) {
    const sibling = out.replace(new RegExp(`\\.${STILL_EXT}$`), `.${stale}`);
    if (existsSync(sibling)) unlinkSync(sibling);
  }

  rmSync(dir, { recursive: true, force: true });
  assembled.push({ id: meta.id, cell: `${meta.lang}/${meta.theme}`, chunks: meta.chunks, height: targetHeight + PAD * 2, bytes });
}

const tall = assembled.filter((item) => item.chunks > 1);
console.log(`合成 ${assembled.length} 张，其中拼接 ${tall.length} 张`);
for (const item of tall) console.log(`  ${item.id} [${item.cell}]: ${item.chunks} 屏 → ${item.height}px`);
if (converted.length) {
  console.log(`降质重编 ${converted.length} 张`);
  for (const item of converted) console.log(`  ${item.id} [${item.cell}]: ${Math.round(item.before / 1024)}KB → ${Math.round(item.after / 1024)}KB`);
}
if (oversized.length) {
  console.log(`仍超 ${Math.round(LIMIT / 1024)}KB：${oversized.length} 张`);
  for (const item of oversized) console.log(`  ${item.id} [${item.cell}]: ${Math.round(item.bytes / 1024)}KB`);
}
for (const item of skipped) console.log(`  跳过 ${item.dir}: ${item.reason}`);
