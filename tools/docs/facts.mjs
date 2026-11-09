#!/usr/bin/env node
// Build the code-side fact table that every showcase surface must match.
//
// The defaults are not parsed out of `src/defaults.js` with regexes: the module
// is bundled to CommonJS and executed, so a renamed key or a changed literal
// shows up here immediately. Numeric ranges are recovered by feeding -1e9 and
// +1e9 through `normalizeSettings` and reading what survives the clamp, which
// keeps the range table honest even when the clamp lives far from the default.
//
//   node tools/docs/facts.mjs [--out audit/facts.json]
import { build } from "esbuild";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const CACHE = join(HERE, ".cache");
const OUT = option("--out") ?? join(ROOT, "audit", "facts.json");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function bundleModule(entrySource, name) {
  mkdirSync(CACHE, { recursive: true });
  const entry = join(CACHE, `${name}.entry.mjs`);
  const outfile = join(CACHE, `${name}.cjs`);
  writeFileSync(entry, entrySource, "utf8");
  await build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    logLevel: "silent"
  });
  return outfile;
}

const SRC = (file) => JSON.stringify(join(ROOT, "src", file));

const outfile = await bundleModule(
  [
    `export { DEFAULT_SETTINGS, normalizeSettings } from ${SRC("defaults.js")};`,
    `export { PDF_PAGE_SIZE_NAMES, MARGIN_PRESETS } from ${SRC("print-geometry.js")};`
  ].join("\n"),
  "defaults"
);

const require = createRequire(import.meta.url);
const mod = require(outfile);
const { DEFAULT_SETTINGS, normalizeSettings, PDF_PAGE_SIZE_NAMES, MARGIN_PRESETS } = mod;

// --- labels ---------------------------------------------------------------
// User-facing names are not derivable without booting Obsidian, so they are
// listed here. Every entry is checked against settings-tab.js below: if the
// literal disappears from the UI source, the build fails instead of silently
// describing a setting that no longer exists.
const LABELS = [
  ["language", "语言", "Language", "enum"],
  ["captionGap", "图片与说明间距", "Image-to-caption gap", "px"],
  ["imageBottomGap", "图片下边距", "Image bottom margin", "px"],
  ["textGap", "正文与图片间距", "Text-to-image gap", "px"],
  ["mobileBreakpoint", "移动布局断点", "Mobile layout breakpoint", "px"],
  ["galleryControl", "画廊视图控制", "Gallery layout control", "enum"],
  ["galleryMinHeight", "画廊最小高度", "Gallery min height", "px"],
  ["galleryMaxHeight", "画廊最大高度", "Gallery max height", "px"],
  ["galleryOrphanMaxHeight", "孤儿图片最大高度", "Orphan image max height", "px"],
  ["galleryMaxPerRow", "画廊最大并列", "Gallery max per row", "count"],
  ["galleryGap", "画廊图片间距", "Gallery image gap", "px"],
  ["widthControl.gain", "栏宽增益", "Width gain", "count"],
  ["widthControl.medianRatio", "中位比例", "Median ratio", "number"],
  ["floatMax", "浮动最大生效宽度", "Float max effective width", "percent"],
  ["resizeEnabled", "实时预览拖拽调宽", "Drag-to-resize in Live Preview", "bool"],
  ["alignButtonsEnabled", "显示对齐箭头", "Show alignment arrows", "bool"],
  ["floatSpaceMode", "浮动空间策略", "Float space", "enum"],
  ["pdfExport.pageSize", "纸张", "Paper size", "enum"],
  ["pdfExport.orientation", "方向", "Orientation", "enum"],
  ["pdfExport.marginMode", "页边距", "Margins", "enum"],
  ["pdfExport.marginPreset", "边距预设", "Margin preset", "enum"],
  ["pdfExport.mirrorMargins", "奇偶页不同", "Different odd/even pages", "bool"],
  ["pdfExport.innerMarginMm", "内侧", "Inner", "mm"],
  ["pdfExport.outerMarginMm", "外侧", "Outer", "mm"],
  ["pdfExport.scalePercent", "缩放", "Scale", "enum"],
  ["pdfExport.includeTitle", "包含笔记标题", "Include note title", "bool"],
  ["pdfExport.pageNumber.enabled", "页码", "Page numbers", "bool"],
  ["pdfExport.pageNumber.band", "页码位置", "Page number position", "enum"],
  ["pdfExport.pageNumber.align", "页码对齐", "Page number align", "enum"],
  ["pdfExport.previewMode", "打印窗口默认视图", "Default print window view", "enum"],
  ["pdfExport.timeoutMs", "导出超时", "Export timeout", "ms"],
  ["pdfExportEnabled", "在 Obsidian 原生 PDF 导出中生效", "Applies in Obsidian native PDF export", "bool"],
  ["pdfPagination.headingBreakEnabled", "默认标题分页导出设置", "Default heading-pagination export settings", "bool"],
  ["pdfPagination.headingBreakLevel", "标题分页起始等级", "Heading pagination start level", "count"],
  ["pdfPagination.imageOptimizationEnabled", "图片分页优化", "Image pagination optimization", "bool"],
  ["pdfPagination.imageShrinkPriority", "图片分页优化优先使用裕度", "Image pagination priority margin", "enum"],
  ["pdfPagination.singleImageMaxShrink", "图片最大压缩高度", "Max image shrink", "ratio"],
  ["pdfPagination.lineHeightMaxShrink", "行距最大压缩高度", "Max line-height shrink", "ratio"],
  ["pdfPagination.orphanControlEnabled", "孤行控制", "Orphan control", "bool"],
  ["pdfPagination.orphanMaxLines", "末页允许行数", "Trailing page allowed lines", "count"]
];

// Ranges the clamp cannot recover: the default is a string ("inherit") or the
// normaliser snapshots the value without touching it.
const EXPLICIT_RANGES = {
  "pdfExport.scalePercent": { kind: "enum", values: ["inherit", "10-200%"] },
  "pdfExport.pageSize": { kind: "enum", values: ["inherit", ...PDF_PAGE_SIZE_NAMES] },
  "pdfExport.marginPreset": { kind: "enum", values: ["none", "narrow", "moderate", "wide", ...(MARGIN_PRESETS ? Object.keys(MARGIN_PRESETS) : [])] },
  "language": { kind: "enum", values: ["follow", "zh", "en"] },
  "galleryControl": { kind: "enum", values: ["both", "count", "height"] },
  "floatSpaceMode": { kind: "enum", values: ["ordered", "share"] },
  "pdfPagination.imageShrinkPriority": { kind: "enum", values: ["image", "line"] },
  "pdfExport.pageNumber.band": { kind: "enum", values: ["header", "footer"] },
  "pdfExport.pageNumber.align": { kind: "enum", values: ["left", "center", "right"] },
  "pdfExport.previewMode": { kind: "enum", values: ["layout", "pages"] },
  "pdfExport.orientation": { kind: "enum", values: ["inherit", "portrait", "landscape"] },
  "pdfExport.marginMode": { kind: "enum", values: ["inherit", "preset", "custom"] }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    cursor[part] = { ...(cursor[part] ?? {}) };
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function getPath(target, path) {
  return path.split(".").reduce((cursor, part) => cursor?.[part], target);
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function display(value, unit) {
  if (value === undefined || value === null) return null;
  if (unit === "ratio") return `${round(value * 100)}%`;
  if (unit === "percent") return `${round(value)}%`;
  if (unit === "ms") return `${round(value / 1000)}s`;
  return String(value);
}

function numericRange(path) {
  const low = clone(DEFAULT_SETTINGS);
  setPath(low, path, -1e9);
  const high = clone(DEFAULT_SETTINGS);
  setPath(high, path, 1e9);
  const min = getPath(normalizeSettings(low), path);
  const max = getPath(normalizeSettings(high), path);
  return [round(min), round(max)];
}

const settings = LABELS.map(([path, labelZh, labelEn, unit]) => {
  const value = getPath(DEFAULT_SETTINGS, path);
  const entry = {
    key: path,
    labels: { zh: labelZh, en: labelEn },
    default: value,
    display: display(value, unit),
    unit,
    source: sourceOf(path)
  };
  if (unit === "bool") {
    entry.values = [true, false];
  } else if (EXPLICIT_RANGES[path]) {
    entry.values = EXPLICIT_RANGES[path].values;
  } else if (typeof value === "number") {
    const [min, max] = numericRange(path);
    entry.range = { min, max };
    entry.rangeDisplay = `${display(min, unit)}–${display(max, unit)}`;
  }
  return entry;
});

function sourceOf(path) {
  const text = read("src/defaults.js");
  const parts = path.split(".");
  const leaf = parts.at(-1);
  const parent = parts.length > 1 ? parts.at(-2) : null;
  const lines = text.split("\n");
  let start = 0;
  if (parent) {
    const anchor = lines.findIndex((line) => new RegExp(`\\b${parent}\\s*:`).test(line));
    if (anchor >= 0) start = anchor;
  }
  const offset = lines.slice(start).findIndex((line) => new RegExp(`\\b${leaf}\\s*:`).test(line));
  return `src/defaults.js:${start + Math.max(offset, 0) + 1}`;
}

function read(relative) {
  return readFileSync(join(ROOT, relative), "utf8");
}

// Labels must still exist in the settings UI. A removed label means the fact
// table is describing a control nobody can find.
const settingsTab = read("src/settings-tab.js");
const enSettings = read("src/locales/en-settings.js");
const missingLabels = [];
for (const [, zh, en] of LABELS) {
  if (!settingsTab.includes(zh)) missingLabels.push(zh);
  if (!enSettings.includes(en)) missingLabels.push(en);
}

// --- ag: parameters -------------------------------------------------------
// Ranges are read from the parser functions; the declarations below are
// cross-checked against the literal bounds in annotations.js.
const PARAMS = [
  { name: "layout", syntax: "auto | gallery | float | center", source: "src/annotations.js:65-68", values: ["auto", "gallery", "float", "center"] },
  { name: "side", syntax: "left | right | center | centre", source: "src/annotations.js:69-72", values: ["left", "right", "center", "centre"] },
  { name: "width", syntax: "10%–100%（必须带 %）", source: "src/annotations.js:327-335", range: { min: 10, max: 100, unit: "%" } },
  { name: "gap", syntax: "0–80（可省略 px）", source: "src/annotations.js:337-342", range: { min: 0, max: 80, unit: "px" } },
  { name: "crop", syntax: "W:H，W/H 各自 1–50，比例 0.1–10", source: "src/annotations.js:346-354", range: { min: 0.1, max: 10, unit: "ratio" } },
  { name: "top", syntax: "x1:x2:y，三段，各 0–100；必须与 crop 同时存在", source: "src/annotations.js:385-394" },
  { name: "rows", syntax: "逗号分隔，每项 1–15，最多 30 项", source: "src/annotations.js:366-377", range: { min: 1, max: 15, unit: "count" } },
  { name: "group", syntax: "正整数；裸标记等于 1；false 取消", source: "src/annotations.js:55-63" },
  { name: "isolate", syntax: "标记，或 =false", source: "src/annotations.js:53-54", values: [true, false] },
  { name: "exclude", syntax: "标记，或 =false", source: "src/annotations.js:53-54", values: [true, false] }
];
const annot = read("src/annotations.js");
const params = PARAMS.map((param) => ({
  ...param,
  present: new RegExp(`key === "${param.name}"`).test(annot) || annot.includes(`"${param.name}"`)
}));

const retired = [...(annot.match(/RETIRED_KEYS = new Set\(\[([^\]]+)\]/)?.[1] ?? "").matchAll(/"([^"]+)"/g)]
  .map((match) => match[1]);

// --- commands -------------------------------------------------------------
const plugin = read("plugin.js");
const commands = [...plugin.matchAll(/addCommand\(\{\s*id:\s*"([^"]+)",\s*name:\s*t\("([^"]+)"\)/g)]
  .map((match) => ({ id: match[1], labelZh: match[2], source: "plugin.js" }));
const commandBlocks = [...plugin.matchAll(/id:\s*"(set-image-annotation|clear-image-annotation|reset-document-image-layout|export-pdf)"/g)]
  .map((match) => match[1]);

// --- material inventory ---------------------------------------------------
const figuresPath = join(ROOT, "tools", "capture", "figures.json");
const figures = JSON.parse(readFileSync(figuresPath, "utf8"));
const figureIds = figures.items.map((item) => item.id);
const byKind = {};
for (const item of figures.items) {
  const kind = item.kind ?? "content";
  byKind[kind] = (byKind[kind] ?? 0) + 1;
}

const docsRoot = resolve(ROOT, "../obsidian_autogallery_docs");
const posterDir = join(docsRoot, "docs", "public", "media", "posters");
const posterIds = existsSync(posterDir)
  ? readdir(posterDir).map((entry) => entry.name.replace(/\.[^.]+$/, "")).filter((id) => /^AG-P\d{2}-\d{2}[ab]?$/.test(id))
  : [];
const docsPages = listMarkdown(join(docsRoot, "docs", "zh"));
const docsPagesEn = listMarkdown(join(docsRoot, "docs", "en"));

function listMarkdown(dir, { skipEn } = {}) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (current) => {
    for (const entry of readdir(current)) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (skipEn && entry.name === "en") continue;
        walk(full);
      } else if (entry.name.endsWith(".md")) {
        out.push(full);
      }
    }
  };
  walk(dir);
  return out;
}

function readdir(dir) {
  return require("node:fs").readdirSync(dir, { withFileTypes: true });
}

function gitHead() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const facts = {
  version: 1,
  generatedAt: new Date().toISOString(),
  plugin: {
    id: "obsidian-autogallery",
    version: JSON.parse(read("manifest.json")).version,
    minAppVersion: JSON.parse(read("manifest.json")).minAppVersion,
    commit: gitHead(),
    testScript: Boolean(JSON.parse(read("package.json")).scripts?.test)
  },
  settings,
  params,
  retiredParams: retired,
  commands: { registered: commands, ids: commandBlocks },
  pdf: {
    pageNumbersBandMm: 11,
    defaultTimeoutMs: DEFAULT_SETTINGS.pdfExport.timeoutMs,
    headingBreakDefault: DEFAULT_SETTINGS.pdfPagination.headingBreakEnabled,
    headingBreakLevelDefault: DEFAULT_SETTINGS.pdfPagination.headingBreakLevel,
    imageShrinkDefault: DEFAULT_SETTINGS.pdfPagination.singleImageMaxShrink,
    lineShrinkDefault: DEFAULT_SETTINGS.pdfPagination.lineHeightMaxShrink,
    orphanDefault: DEFAULT_SETTINGS.pdfPagination.orphanControlEnabled,
    orphanMaxLinesDefault: DEFAULT_SETTINGS.pdfPagination.orphanMaxLines
  },
  figures: {
    total: figures.items.length,
    byKind,
    ids: figureIds,
    posters: posterIds,
    retired: figures.retired?.length ?? 0,
    textOnly: figures.textOnly?.length ?? 0
  },
  docs: {
    pagesZh: docsPages.length,
    pagesEn: docsPagesEn.length
  },
  warnings: {
    missingLabels: [...new Set(missingLabels)]
  }
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(facts, null, 2)}\n`, "utf8");
rmSync(CACHE, { recursive: true, force: true });

console.log(JSON.stringify({
  out: OUT,
  settings: settings.length,
  params: params.length,
  commands: commands.length,
  figures: figures.items.length,
  docsPages: facts.docs.pagesZh,
  warnings: facts.warnings
}, null, 2));
