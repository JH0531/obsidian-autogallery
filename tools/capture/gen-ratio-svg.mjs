// Generate the ratio swatches used across the demo vault.
//
// Source motifs live in the Illustrator export folder as white silhouettes; each
// one is a single seamless path on its own viewBox. The mapping is positional:
// resource N belongs to the Nth ratio, ordered from widest to narrowest.
//
//   node tools/capture/gen-ratio-svg.mjs [--out assets/ratio]
//
// Colour model
//   background  HSL of the theme colour, top-left → bottom-right:
//               hue −3%…+3% of the circle, saturation +0…+10, lightness +20…−20
//   texture     the same colour lifted to L+30 / S+20 (3:2 drops to L−20 instead,
//               because a white-ish tint is invisible on #FFEE6F), at 10% opacity
//
// Density is expressed as "units per row" so the tiling can be tuned per shape
// without touching the arithmetic: the tile is always canvasWidth / units.
//
// Text: baseline offset is 0.35em, which puts the ink box exactly on the vertical
// centre for these glyphs. Horizontally, `text-anchor="middle"` centres the
// advance box rather than the ink, and each label's side bearings differ, so a
// small per-label `opticalDx` (in em, measured in Chromium) nudges the glyphs
// onto the true centre. Re-measure after changing the font.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// The Illustrator export folder is the original source, but it is not part of
// this vault and can move. `motifs.json` caches the ten paths so the swatches
// stay reproducible; `--refresh` re-reads the folder when it is available.
const SRC = "D:/Jasper/Downloads/svg素材/SVG";
const CACHE = new URL("./motifs.json", import.meta.url);
const REFRESH = process.argv.includes("--refresh");

// Widest → narrowest. `units: null` keeps the original short-side rule (six
// units across the short edge, which reads as six across on square-ish frames).
const specs = [
  { key: "3x1", w: 1800, h: 600, label: "3:1", color: "#A72126", res: 1, units: 8, opticalDx: 0.02 },
  { key: "21x9", w: 1680, h: 720, label: "21:9", color: "#C35C6A", res: 2, units: 8, opticalDx: 0.0 },
  { key: "16x9", w: 1600, h: 900, label: "16:9", color: "#E18A3B", res: 3, units: null, opticalDx: 0.003 },
  // 3:2 is the only swatch with a dark texture on a bright ground, so it needs a
  // denser overlay to read at all — 10% disappears completely on #FFEE6F.
  { key: "3x2", w: 1200, h: 800, label: "3:2", color: "#FFEE6F", res: 4, units: null, opticalDx: 0.003, textureOpacity: 0.3 },
  { key: "4x3", w: 1200, h: 900, label: "4:3", color: "#4C8045", res: 5, units: null, opticalDx: 0.024 },
  { key: "1x1", w: 1000, h: 1000, label: "1:1", color: "#3D8E86", res: 6, units: null, opticalDx: 0.031 },
  { key: "3x4", w: 900, h: 1200, label: "3:4", color: "#2E59A7", res: 7, units: null, opticalDx: -0.021 },
  { key: "2x3", w: 800, h: 1200, label: "2:3", color: "#003D74", res: 8, units: 4, opticalDx: 0.012 },
  { key: "9x16", w: 720, h: 1280, label: "9:16", color: "#6C216D", res: 9, units: 4, opticalDx: -0.003 },
  { key: "1x3", w: 600, h: 1800, label: "1:3", color: "#422256", res: 10, units: 4, opticalDx: 0.016 },
];

// Hue is shifted by a percentage of the colour wheel rather than by degrees:
// ±3% of 360° is ±10.8°. Kept as a literal because that is the exact value the
// current swatches were built with — 3 * 3.6 lands on 10.799999999999999 and
// would make future regenerations differ in the last hex digit.
const HUE_SHIFT_PERCENT = 3;
const HUE_SHIFT_DEG = 10.8;

const TEXTURE_OPACITY = 0.1;
const TEXTURE_LIGHT_STEP = { light: 30, dark: -20 };
const DARK_TEXTURE_KEYS = new Set(["3x2"]);

const outFlag = process.argv.indexOf("--out");
const outDir = outFlag > -1 ? process.argv[outFlag + 1] : "assets/ratio";
mkdirSync(outDir, { recursive: true });

const motifCache = REFRESH ? null : readCache();

function readCache() {
  try {
    return JSON.parse(readFileSync(CACHE, "utf8"));
  } catch {
    return null;
  }
}

function readFromSource(index) {
  const text = readFileSync(path.join(SRC, `资源 ${index}.svg`), "utf8");
  const viewBox = /viewBox="([^"]+)"/.exec(text)[1].trim().split(/[\s,]+/).map(Number);
  // One path per file, always with `d` as the last attribute; keep it verbatim
  // so the motif is never re-interpreted.
  const d = /<path[^>]*\sd="([^"]+)"/.exec(text)[1];
  return { w: viewBox[2], h: viewBox[3], d };
}

function loadMotif(index) {
  const cached = motifCache?.[index] ?? motifCache?.[String(index)];
  if (cached) return cached;
  try {
    return readFromSource(index);
  } catch (error) {
    console.error(
      `缺少纹样 ${index}：既没有 ${CACHE} 里的缓存，也读不到 ${SRC}\\资源 ${index}.svg。\n`
      + "把导出目录放回原位后加 --refresh 重新生成缓存。"
    );
    throw error;
  }
}

function hexToHsl(hex) {
  const [r, g, b] = hex.match(/[0-9a-f]{2}/gi).map((v) => parseInt(v, 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const lit = Math.min(100, Math.max(0, l)) / 100;
  const a = sat * Math.min(lit, 1 - lit);
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    const c = lit - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * c).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function luminance(hex) {
  const [r, g, b] = hex
    .match(/[0-9a-f]{2}/gi)
    .map((v) => parseInt(v, 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

for (const spec of specs) {
  const { key, w, h, label, color, res } = spec;
  const motif = loadMotif(res);
  const short = Math.min(w, h);
  const [hue, sat, light] = hexToHsl(color);

  // Background: hue drifts −3%…+3% of the circle, saturation opens up by 10,
  // lightness falls from +20 to −20.
  const start = hslToHex(hue - HUE_SHIFT_DEG, sat + 0, light + 20);
  const end = hslToHex(hue + HUE_SHIFT_DEG, sat + 10, light - 20);

  // Texture is a tint of the same theme colour, not white, so it belongs to the
  // swatch instead of sitting on top of it.
  const step = DARK_TEXTURE_KEYS.has(key) ? TEXTURE_LIGHT_STEP.dark : TEXTURE_LIGHT_STEP.light;
  const ink = hslToHex(hue, sat + 20, light + step);
  const opacity = spec.textureOpacity ?? TEXTURE_OPACITY;

  const tile = spec.units ? w / spec.units : short / 6;
  const scale = tile / motif.w;
  const fontSize = Math.round(short * 0.21);
  const textInk = luminance(color) > 0.32 ? "#1c1c1c" : "#ffffff";
  const dx = spec.opticalDx ? ` dx="${spec.opticalDx}em"` : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <!-- ${label} · 主色 ${color} · 图案资源 ${res} · 行内 ${spec.units ?? 6} 单元 · 纹理 ${ink} @${Math.round(opacity * 100)}% -->
  <defs>
    <linearGradient id="bg-${key}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${start}"/>
      <stop offset="1" stop-color="${end}"/>
    </linearGradient>
    <pattern id="pat-${key}" width="${motif.w}" height="${motif.h}" patternUnits="userSpaceOnUse"
             patternTransform="scale(${scale.toFixed(4)})">
      <path d="${motif.d}" fill="${ink}" fill-opacity="${opacity}"/>
    </pattern>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bg-${key})"/>
  <rect width="${w}" height="${h}" fill="url(#pat-${key})"/>
  <text x="50%" y="50%" dy="0.35em"${dx} text-anchor="middle"
        font-family="-apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
        font-size="${fontSize}" font-weight="600" fill="${textInk}" fill-opacity="0.95">${label}</text>
</svg>
`;
  writeFileSync(path.join(outDir, `ratio-${key}.svg`), svg, "utf8");
  console.log(
    `${label.padEnd(5)} ${color}  背景 ${start} → ${end}   纹理 ${ink}  单元 ${Math.round(tile)}px`
  );
}
