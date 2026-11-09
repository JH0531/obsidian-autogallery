#!/usr/bin/env node
// Mechanical acceptance checks for the demo vault.
//
//   node tools/capture/manifest-check.mjs           # human report
//   node tools/capture/manifest-check.mjs --json    # machine report
//
// Exit code 1 when any error is found. Warnings never fail the run.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveVault } from "./lib/vault.mjs";
import {
  LANGS, THEMES, THEME_ANY, variants, variantKey, stillRel, motionRel, posterRel, posterId,
  webpSize, isWebp
} from "./lib/media.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = resolveVault();
const asJson = process.argv.includes("--json");

const errors = [];
const warnings = [];
const err = (code, message) => errors.push({ code, message });
const warn = (code, message) => warnings.push({ code, message });

const mdFiles = readdirSync(vault).filter((name) => name.endsWith(".md")).sort();
const mdText = new Map(mdFiles.map((name) => [name, readFileSync(path.join(vault, name), "utf8")]));

// ---------------------------------------------------------------- links
const noteNames = new Set(mdFiles.map((name) => name.replace(/\.md$/, "")));
for (const [name, text] of mdText) {
  // `![[...]]` is an image embed and is checked below; a table cell escapes the
  // pipe as `\|`, which must not leak into the link target.
  for (const match of text.matchAll(/(?<!!)\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) {
    const target = match[1].trim().replace(/\\+$/, "");
    if (!target) continue;
    if (!noteNames.has(target)) err("link", `${name}: 无法解析 [[${target}]]`);
  }
}

// ---------------------------------------------------------------- images
const imageExt = /\.(png|jpe?g|gif|webp|avif|svg|mp4|webm)$/i;
const assetNames = new Set();
(function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (imageExt.test(entry.name)) assetNames.add(entry.name);
  }
})(vault);

for (const [name, text] of mdText) {
  for (const match of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = decodeURI(match[1]);
    if (/^(https?:)?\/\//i.test(target)) continue;
    const full = path.join(vault, target);
    if (!existsSync(full)) err("image", `${name}: 图片不存在 ${target}`);
  }
  for (const match of text.matchAll(/!\[\[([^\]|]+)(?:[|#][^\]]*)?\]\]/g)) {
    const target = match[1].trim();
    if (!existsSync(path.join(vault, target)) && !assetNames.has(path.basename(target))) {
      err("image", `${name}: 内嵌图片不存在 ${target}`);
    }
  }
}

// ---------------------------------------------------------------- hygiene
for (const [name, text] of mdText) {
  for (const bad of [/F:\//i, /[A-Z]:\\/, /file:\/\//i, /obsidian-autogallery-demo\//i]) {
    if (bad.test(text)) err("absolute-path", `${name}: 含绝对路径 ${bad}`);
  }
  if (/拍摄脚本|录制脚本/.test(text)) err("recording-text", `${name}: 正文出现录制说明`);
}

// ---------------------------------------------------------------- ids
const manifest = JSON.parse(readFileSync(path.join(vault, "media", "manifest.json"), "utf8"));
if (manifest.version !== 3) err("manifest-version", `manifest 版本 ${manifest.version}，期望 3（四版本矩阵）`);

// A figure id is stable across the four cells; the cell is the language and the
// theme, so uniqueness has to be checked on the triple.
const keys = manifest.items.map((item) => variantKey(item.id, item.lang, item.theme));
if (new Set(keys).size !== keys.length) err("variant-duplicate", "manifest 存在重复的 id/lang/theme");
for (const item of manifest.items) {
  if (!LANGS.includes(item.lang)) err("lang-unknown", `${item.id}: 语言 ${item.lang}`);
  if (item.theme !== THEME_ANY && !THEMES.includes(item.theme)) err("theme-unknown", `${item.id}: 主题 ${item.theme}`);
}

// Every figure belongs to exactly one documentation page; that link is what
// keeps the vault and the site from drifting apart.
const PAGES = new Set([
  "guide/install", "guide/quick-start", "guide/concepts",
  "gallery/grouping", "gallery/rows", "gallery/height", "gallery/handles",
  "single/width", "single/float", "single/resize",
  "annotations/syntax", "annotations/crop", "annotations/scopes", "annotations/dialog",
  "templates/profiles", "templates/import", "templates/routing",
  "export/dialog", "export/pagination", "export/troubleshooting",
  "reference/settings", "reference/commands", "reference/compatibility",
  "reference/pitfalls", "changelog"
]);
for (const item of manifest.items) {
  if (!item.page) err("page-missing", `${item.id}: 未声明所属页面`);
  else if (!PAGES.has(item.page)) err("page-unknown", `${item.id}: 未知页面 ${item.page}`);
}

// The id itself carries neither language nor theme any more; the directory does.
const ids = [...new Set(manifest.items.map((item) => item.id))];

// `a` / `b` suffix marks one behaviour split across two frames.
for (const id of ids) {
  if (!/^AG-[SAVP]\d{2}-\d{2}[ab]?$/.test(id)) err("id-format", `编号格式非法 ${id}`);
}

// Sequence numbers are contiguous per media+page group.
const groups = new Map();
for (const id of ids) {
  const match = /^AG-([SAVP])(\d{2})-(\d{2})([ab])?$/.exec(id);
  if (!match) continue;
  const key = `${match[1]}${match[2]}`;
  if (!groups.has(key)) groups.set(key, new Set());
  groups.get(key).add(Number(match[3]));
}
for (const [key, seqs] of [...groups].sort()) {
  const sorted = [...seqs].sort((a, b) => a - b);
  if (sorted.some((value, index) => value !== index + 1)) {
    err("id-gap", `${key} 序号不连续：${sorted.join(", ")}`);
  }
}

// ---------------------------------------------------------------- media files
const LIMITS = { still: 1.2 * 1024 * 1024, apng: 8 * 1024 * 1024, mp4: 6 * 1024 * 1024 };
const probe = (file) => {
  try {
    return JSON.parse(execFileSync("ffprobe", [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", file
    ], { encoding: "utf8" }));
  } catch {
    return null;
  }
};

for (const item of manifest.items) {
  if (!item.file) continue;
  const cell = `${item.lang}/${item.theme}`;

  // The path is not a suggestion: a frame sitting in another cell's directory
  // would be served to readers of the wrong theme or locale.
  const expected = item.media === "still"
    ? stillRel(item.id, item.lang, item.theme)
    : motionRel(item.id, item.lang, item.theme, item.media === "apng" ? "png" : "mp4");
  if (item.file !== expected) err("path", `${item.id} [${cell}]: 登记 ${item.file}，期望 ${expected}`);

  const full = path.join(vault, item.file);
  if (!existsSync(full)) { err("missing-file", `${item.id} [${cell}]: 登记的文件不存在 ${item.file}`); continue; }
  const bytes = statSync(full).size;
  if (item.bytes !== bytes) err("bytes", `${item.id} [${cell}]: 字节数与 manifest 不一致（${item.bytes} → ${bytes}）`);
  if (bytes > LIMITS[item.media]) err("size", `${item.id} [${cell}]: ${Math.round(bytes / 1024)}KB 超过上限`);

  // A poster is theme-independent: one file per language, and it must be an
  // APNG. GitHub transcodes an animated WebP and drops the frames.
  if (item.poster) {
    const wanted = posterRel(posterId(item.id), item.lang);
    if (item.poster !== wanted) err("poster-path", `${item.id} [${cell}]: poster ${item.poster}，期望 ${wanted}`);
    const posterFile = path.join(vault, item.poster);
    if (!existsSync(posterFile)) err("poster-missing", `${item.id} [${cell}]: poster 不存在 ${item.poster}`);
    else if (readFileSync(posterFile).indexOf("acTL") < 0) err("poster-apng", `${item.id} [${cell}]: poster 不是 APNG`);
  }

  if (item.media === "still") {
    if (!/\.webp$/i.test(item.file)) err("still-ext", `${item.id} [${cell}]: 静帧必须是 .webp`);
    if (!isWebp(full)) { err("still-format", `${item.id} [${cell}]: 不是合法 WebP`); continue; }
    const size = webpSize(full);
    if (!size) err("still-dims", `${item.id} [${cell}]: 读不出 WebP 尺寸`);
    else if (item.width !== size.width || item.height !== size.height) {
      err("still-dims", `${item.id} [${cell}]: manifest ${item.width}×${item.height}，实际 ${size.width}×${size.height}`);
    }
    continue;
  }

  const info = probe(full);
  if (!info) { err("probe", `${item.id} [${cell}]: ffprobe 读取失败`); continue; }
  const stream = info.streams?.[0] ?? {};
  if (item.media === "apng") {
    if (!/\.png$/i.test(item.file)) err("apng-ext", `${item.id} [${cell}]: APNG 必须用 .png 后缀`);
    if (stream.codec_name !== "apng") err("apng-codec", `${item.id} [${cell}]: codec=${stream.codec_name}`);
    // ffmpeg's apng demuxer does not report nb_frames; read the acTL chunk
    // instead, which is also the definitive "this is an APNG" marker.
    const buffer = readFileSync(full);
    const at = buffer.indexOf("acTL");
    if (at < 0) { err("apng-frames", `${item.id} [${cell}]: 缺少 acTL 块`); }
    else {
      const frames = buffer.readUInt32BE(at + 4);
      const plays = buffer.readUInt32BE(at + 8);
      if (frames < 2) err("apng-frames", `${item.id} [${cell}]: 帧数 ${frames}`);
      if (plays !== 0) warn("apng-loop", `${item.id} [${cell}]: 循环次数 ${plays}（期望 0 = 无限）`);
    }
  } else {
    if (stream.codec_name !== "h264") err("mp4-codec", `${item.id} [${cell}]: codec=${stream.codec_name}`);
    if (stream.pix_fmt !== "yuv420p") err("mp4-pixfmt", `${item.id} [${cell}]: pix_fmt=${stream.pix_fmt}`);
    if (Number(stream.width) % 2 || Number(stream.height) % 2) err("mp4-odd", `${item.id} [${cell}]: 宽高必须为偶数`);
    if (info.streams.some((s) => s.codec_type === "audio")) err("mp4-audio", `${item.id} [${cell}]: 不应包含音轨`);
    const head = readFileSync(full).subarray(0, 4096).toString("latin1");
    const moov = head.indexOf("moov");
    const mdat = head.indexOf("mdat");
    if (moov < 0 || (mdat >= 0 && moov > mdat)) warn("mp4-faststart", `${item.id} [${cell}]: moov 不在文件头（缺 +faststart）`);
  }
}

// Coverage is reported per cell. A half-filled matrix is a normal state while
// producing; it must never be invisible.
const seen = [...new Set(manifest.items.map((item) => `${item.lang}/${item.theme}`))];
const coverage = seen.sort().map((key) => {
  const rows = manifest.items.filter((item) => `${item.lang}/${item.theme}` === key);
  return { cell: key, done: rows.filter((row) => row.status !== "planned").length, total: rows.length };
});
for (const entry of coverage) {
  if (entry.done < entry.total) warn("coverage", `${entry.cell}: ${entry.done}/${entry.total} 已产出`);
}

// ---------------------------------------------------------------- config
const baseline = JSON.parse(readFileSync(path.join(here, "baseline.json"), "utf8"));
const dataPath = path.join(vault, ".obsidian", "plugins", "obsidian-autogallery", "data.json");
const current = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, "utf8")) : {};
for (const key of Object.keys(baseline)) {
  if (JSON.stringify(current[key]) !== JSON.stringify(baseline[key])) err("baseline", `data.json 与基线不一致：${key}`);
}

const workspacePath = path.join(vault, ".obsidian", "workspace.json");
if (existsSync(workspacePath)) {
  const workspace = JSON.parse(readFileSync(workspacePath, "utf8"));
  // Only leaf state actually loads a file; `lastOpenFiles` is a recency list
  // that Obsidian rewrites itself, so stale entries there are not errors.
  const leafFiles = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.state?.file === "string") leafFiles.push(node.state.file);
    for (const child of node.children ?? []) walk(child);
  };
  walk(workspace.main);
  walk(workspace.left);
  walk(workspace.right);
  for (const file of leafFiles) {
    if (!existsSync(path.join(vault, file))) err("workspace", `标签页引用了不存在的文件 ${file}`);
  }
}

const coreAllowed = new Set(["file-explorer", "global-search", "switcher", "properties", "command-palette", "outline", "bases"]);
const corePath = path.join(vault, ".obsidian", "core-plugins.json");
if (existsSync(corePath)) {
  const core = JSON.parse(readFileSync(corePath, "utf8"));
  for (const [key, value] of Object.entries(core)) {
    if (!coreAllowed.has(key) && value === true) warn("core-plugin", `白名单外的核心插件仍启用：${key}`);
  }
}

// ---------------------------------------------------------------- report
const counts = manifest.items.reduce((acc, item) => (acc[item.status] = (acc[item.status] ?? 0) + 1, acc), {});
const report = {
  notes: mdFiles.length,
  items: manifest.items.length,
  status: counts,
  coverage,
  errors,
  warnings
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`笔记 ${report.notes} 篇 · 镜头 ${report.items} 条 ${JSON.stringify(counts)}`);
  console.log(`四格：${coverage.map((c) => `${c.cell} ${c.done}/${c.total}`).join(" · ")}`);
  for (const item of errors) console.log(`  ✗ [${item.code}] ${item.message}`);
  for (const item of warnings) console.log(`  ! [${item.code}] ${item.message}`);
  console.log(errors.length ? `\n${errors.length} 个错误，${warnings.length} 个警告` : `\n通过（${warnings.length} 个警告）`);
}
process.exit(errors.length ? 1 : 0);
