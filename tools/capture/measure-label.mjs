// Measure where the ratio label actually lands inside each swatch.
//
// Renders the swatch twice in headless Chromium — once as-is, once with the
// <text> element stripped — and diffs the two. The diff bounding box is the ink
// box of the label, so this reports the true optical centre rather than the
// advance-box centre that text-anchor works with.
//
//   node tools/capture/measure-label.mjs
//
// Chromium is the same engine Obsidian uses, so the numbers match production.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const root = process.cwd();
const dir = path.join(root, ".cache", "label-probe");
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const keys = ["3x1", "21x9", "16x9", "3x2", "4x3", "1x1", "3x4", "2x3", "9x16", "1x3"];
const asUrl = (p) => `file:///${p.replace(/\\/g, "/").replace(/ /g, "%20")}`;
const shot = (svgPath, pngPath, w, h) => {
  execFileSync(CHROME, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars",
    `--window-size=${w},${h}`,
    `--screenshot=${pngPath.replace(/\\/g, "/")}`,
    asUrl(svgPath)
  ], { stdio: "ignore" });
};

let worst = 0;
for (const key of keys) {
  const file = path.join(root, "assets", "ratio", `ratio-${key}.svg`);
  const src = readFileSync(file, "utf8");
  const text = /<text[\s\S]*?<\/text>/.exec(src)[0];
  const fontSize = Number(/font-size="(\d+)"/.exec(text)[1]);
  const label = />([^<]+)<\/text>/.exec(text)[1];
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(src).map(Number);

  const bare = path.join(dir, `${key}-bare.svg`);
  writeFileSync(bare, src.replace(text, ""), "utf8");
  const fullPng = path.join(dir, `${key}-full.png`);
  const barePng = path.join(dir, `${key}-bare.png`);
  shot(file, fullPng, w, h);
  shot(bare, barePng, w, h);

  const out = execFileSync("magick", [
    fullPng, barePng, "-compose", "difference", "-composite",
    "-colorspace", "gray", "-threshold", "12%",
    "-trim", "-format", "%w %h %X %Y", "info:"
  ], { encoding: "utf8" }).trim();
  const [iw, ih, ix, iy] = out.split(" ").map((v) => Math.abs(parseInt(v, 10)));
  const dx = ix + iw / 2 - w / 2;
  const dy = iy + ih / 2 - h / 2;
  worst = Math.max(worst, Math.abs(dx), Math.abs(dy));
  console.log(
    `${label.padEnd(5)} fs=${String(fontSize).padStart(3)}  ink ${String(iw).padStart(4)}x${String(ih).padStart(3)}`
    + `  dx ${dx.toFixed(1).padStart(5)}px  dy ${dy.toFixed(1).padStart(5)}px`
    + `  (${((dx / fontSize) * 100).toFixed(1)}% em)`
  );
}
console.log(worst <= 1 ? `ok — 最大偏差 ${worst.toFixed(1)}px` : `仍需校正，最大偏差 ${worst.toFixed(1)}px`);
