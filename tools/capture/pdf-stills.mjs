#!/usr/bin/env node
// Compose a two-page PDF comparison into one still.
//
//   node tools/capture/pdf-stills.mjs --id AG-S19-01 \
//     --left .cache/pdf-row-spacer/h520-off.pdf \
//     --right .cache/pdf-row-spacer/h520-images.pdf --page 1
//
// Each PDF page is rendered at 150 dpi, placed side by side, scaled to the
// 1500px delivery width and encoded to WebP q85. The frame is theme-independent
// (`any`), because a PDF page does not change with the editor theme.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, statSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { resolveVault } from "./lib/vault.mjs";
import { stillRel } from "./lib/media.mjs";

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};

const id = value("--id");
const left = value("--left");
const right = value("--right");
const page = Number(value("--page", "1"));
const lang = value("--lang", "zh");
const theme = value("--theme", "any");
const cropBottom = Number(value("--crop-bottom", "0"));
const cropTop = Number(value("--crop-top", "0"));
if (!id || !left || !right || !Number.isFinite(page)) {
  console.error("用法: node pdf-stills.mjs --id AG-S19-01 --left a.pdf --right b.pdf --page 1");
  process.exit(1);
}

const vault = resolveVault();
const cache = join(vault, ".cache", "pdf-stills");
mkdirSync(cache, { recursive: true });

function render(pdf, name) {
  const prefix = join(cache, name);
  rmSync(`${prefix}-${page}.png`, { force: true });
  execFileSync("pdftoppm", ["-png", "-r", "150", "-f", String(page), "-l", String(page), pdf, prefix]);
  const file = `${prefix}-${page}.png`;
  if (!existsSync(file)) throw new Error(`渲染失败：${pdf} 第 ${page} 页`);
  if (cropBottom > 0) {
    execFileSync("magick", [file, "-gravity", "south", "-crop", `100%x${cropBottom}%+0+0`, "+repage", file]);
  }
  if (cropTop > 0) {
    execFileSync("magick", [file, "-gravity", "north", "-crop", `100%x${cropTop}%+0+0`, "+repage", file]);
  }
  return file;
}

const leftPage = render(left, "left");
const rightPage = render(right, "right");
const target = join(vault, stillRel(id, lang, "any"));
mkdirSync(dirname(target), { recursive: true });

// A pair of pages side by side reads as one continuous spread unless there is
// a visible seam. The separator contrasts with the page: light on a dark
// board, dark on a light one.
const separator = value("--separator", theme === "dark" ? "#E5E7EB" : "#6B7280");
const leftHeight = Number(execFileSync("magick", ["identify", "-format", "%h", leftPage], { encoding: "utf8" }).trim());
const separatorFile = join(cache, "separator.png");
execFileSync("magick", ["-size", `6x${leftHeight}`, `xc:${separator}`, separatorFile]);

execFileSync("magick", [
  leftPage, separatorFile, rightPage,
  "-background", "white", "-gravity", "center", "+append",
  "-resize", "1500x",
  "-strip", "-quality", "85", "-define", "webp:method=6",
  target
]);

const bytes = statSync(target).size;
const [width, height] = execFileSync("magick", ["identify", "-format", "%w %h", target], { encoding: "utf8" }).trim().split(" ").map(Number);
if (width !== 1500) throw new Error(`宽度 ${width}，期望 1500`);
if (bytes > 1200 * 1024) throw new Error(`体积 ${bytes}，超过 1.2MB`);
console.log(JSON.stringify({ id, lang, target, width, height, bytes }, null, 2));
