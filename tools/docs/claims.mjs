#!/usr/bin/env node
// Extract every factual claim the showcase makes, then auto-adjudicate the
// subset a machine can settle: numbers in settings tables, `ag:` parameter
// names, figure ids, media references and a list of phrases already proven
// wrong against the code.
//
//   node tools/docs/claims.mjs [--out audit/claims.json]
//
// The output is a ledger, not a report. Each entry keeps the source line so a
// reviewer can open it, and the verdict keeps its evidence so a later edit
// cannot silently disagree with the code.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { join, resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const DOCS = resolve(ROOT, "../obsidian_autogallery_docs");
const OUT = option("--out") ?? join(ROOT, "audit", "claims.json");

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

const facts = JSON.parse(readFileSync(join(ROOT, "audit", "facts.json"), "utf8"));

const NUMERIC = /(?:\d+(?:\.\d+)?\s?(?:%|px|mm|ms|行|页|个|张|类|级|项|条|篇|幅|秒)|\b\d+:\d+\b)/g;
const ABSOLUTE = /(不会|一定|永远|只(?:改|保证|支持|有|在|能|会|需|写)|仅(?:在|对|是|指|改|用)|必须|never|always|only|must|exactly|at most|at least)/gi;
const PARAM = /\bag:([a-z][a-z0-9-]*)/gi;
const FIGURE = /\bAG-[SAVP]\d{2}-\d{2}[ab]?\b/g;
const MEDIA = /\/media\/[A-Za-z0-9._\-\/]+/g;

// Phrases already adjudicated against the code. `why` is what the replacement
// must say; `evidence` is where the truth lives.
const BANNED = [
  {
    re: /不参与单图压缩|excluded from single-image compression|remain excluded from single-image compression/i,
    expected: "画廊行不拆页；作为贴合目标时可整行同比例缩小，格内图片缩、栏位与栏宽不变；不作为 donor，孤行修复也不压它",
    evidence: "src/pdf-pagination.js:262-301, 442-463, 607, 766",
    severity: "P0"
  },
  {
    re: /行距最大压缩高度[^\n|]*\|\s*\*{0,2}5%\*{0,2}\s*\|/,
    expected: "10%（0–20%）",
    evidence: "src/config.json:20, src/defaults.js:66, src/settings-tab.js:785",
    severity: "P0"
  },
  {
    re: /Max line-height shrink\s*\|\s*\*{0,2}5%\*{0,2}\s*\|/i,
    expected: "10% (0–20%)",
    evidence: "src/config.json:20, src/defaults.js:66",
    severity: "P0"
  },
  {
    re: /四类手柄|four kinds of handle/i,
    expected: "五类手柄（列宽、行高、交换/并入、绑定链接、降级状态）",
    evidence: "docs/gallery/handles.md:5 表格列 5 行；gallery-handles.js",
    severity: "P0"
  },
  {
    re: /弹窗里只有\s*\*{0,2}四项\*{0,2}|弹窗只有\s*\*{0,2}四项\*{0,2}|dialog has\s+\*{0,2}four\*{0,2}\s+fields/i,
    expected: "五项：说明、布局、浮动方向、栏宽、间距",
    evidence: "plugin.js:1497-1501",
    severity: "P0"
  },
  {
    re: /templates\/transfer/,
    expected: "templates/import",
    evidence: "docs/templates/import.md",
    severity: "P0"
  },
  {
    re: /文档站\s*25\s*页|25 pages/i,
    expected: "26 页/语言",
    evidence: "docs/**/*.md 实测 26（zh）与 26（en）",
    severity: "P1"
  },
  {
    re: /只改对齐|只改对齐，不写入宽度|only changes alignment|only change alignment/i,
    expected: "同时写入 ag:side、ag:layout 与当前宽度 ag:width",
    evidence: "src/editor-resize.js:979-997",
    severity: "P0"
  },
  {
    re: /打印超时[^。\n]*自动回退|on a print timeout[^.]*falls back/i,
    expected: "仅预览准备失败自动回退；打印超时或产物无效时保留对话框并提供手动按钮",
    evidence: "src/pdf-export.js:68-76 vs src/pdf-export-modal.js:694-702",
    severity: "P0"
  },
  {
    re: /改用本插件管线|use this pipeline/i,
    expected: "原生导出拦截只保证 CSS 级效果，不运行几何分页",
    evidence: "src/pdf-integration.js:7-17, src/pdf-pagination.js:202-228",
    severity: "P0"
  },
  {
    re: /上限\s*\*{0,2}90%\*{0,2}|limit\s+is\s+90%/i,
    expected: "ag:width 合法范围 10%–100%，当前无 90% 上限；该引用已失效",
    evidence: "src/annotations.js:327-335",
    severity: "P1"
  }
];

const SETTING_BY_LABEL = new Map();
for (const setting of facts.settings) {
  SETTING_BY_LABEL.set(normalizeCell(setting.labels.zh), setting);
  SETTING_BY_LABEL.set(normalizeCell(setting.labels.en), setting);
}
const PARAM_NAMES = new Set(facts.params.map((param) => param.name));
// `top` is listed in RETIRED_KEYS because a bare key is never re-emitted, but
// it is still parsed as a crop sub-field; do not report `ag:top` as unknown.
const RETIRED = new Set(facts.retiredParams.filter((name) => name !== "top"));
const FIGURE_IDS = new Set([...facts.figures.ids, ...(facts.figures.posters ?? [])]);

function normalizeCell(value) {
  return String(value ?? "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function numberFrom(text) {
  const match = /-?\d+(?:\.\d+)?/.exec(String(text).replace(/,/g, ""));
  return match ? Number(match[0]) : null;
}

function boolFrom(text) {
  const value = normalizeCell(text).toLowerCase();
  if (/^(开|开启|是|true|on|yes)$/.test(value)) return true;
  if (/^(关|关闭|否|false|off|no)$/.test(value)) return false;
  return null;
}

// Compare a table cell against a setting fact. Returns null when the cell is
// not a single comparable value (ranges, lists, prose), so the checker stays
// quiet instead of guessing.
function compareCell(setting, cell) {
  const text = normalizeCell(cell);
  if (!text) return null;
  if (setting.unit === "bool") {
    const value = boolFrom(text);
    return value === null ? null : { actual: value, expected: setting.default, ok: value === setting.default };
  }
  if (setting.unit === "ratio" || setting.unit === "percent") {
    const number = numberFrom(text);
    if (number === null) return null;
    const expected = Number(setting.display.replace("%", ""));
    return { actual: `${number}%`, expected: setting.display, ok: Math.abs(number - expected) < 0.01 };
  }
  if (["px", "count", "mm", "ms", "number"].includes(setting.unit)) {
    const number = numberFrom(text);
    if (number === null) return null;
    const expected = setting.unit === "ms" ? setting.default / 1000 : Number(setting.default);
    return { actual: number, expected, ok: Math.abs(number - expected) < 0.01 };
  }
  if (setting.values) {
    const hit = setting.values.some((value) => text.toLowerCase().includes(String(value).toLowerCase()));
    return hit ? { actual: text, expected: setting.values.join(" / "), ok: true } : null;
  }
  return null;
}

function walk(root, base, out, skipEn = false) {
  if (!existsSync(root)) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (skipEn && entry.name === "en") continue;
      walk(full, base, out, skipEn);
    } else if (entry.name.endsWith(".md")) {
      out.push({ path: full, surface: relative(base, full).replace(/\\/g, "/") });
    }
  }
  return out;
}

const surfaces = [];
for (const file of ["README-ZH.md", "README.md"]) {
  if (existsSync(join(ROOT, file))) surfaces.push({ path: join(ROOT, file), surface: file });
}
for (const file of readdirSync(join(ROOT, "demo"))) {
  if (file.endsWith(".md")) surfaces.push({ path: join(ROOT, "demo", file), surface: `demo/${file}` });
}
for (const file of readdirSync(join(ROOT, "specifications"))) {
  if (file.endsWith(".md")) surfaces.push({ path: join(ROOT, "specifications", file), surface: `specifications/${file}` });
}
walk(join(DOCS, "docs"), DOCS, surfaces, true);
walk(join(DOCS, "docs", "en"), DOCS, surfaces);

const claims = [];
let sequence = 0;

function add(claim) {
  sequence += 1;
  claims.push({
    id: `CLM-${String(sequence).padStart(4, "0")}`,
    ...claim
  });
}

for (const { path, surface } of surfaces) {
  const text = readFileSync(path, "utf8");
  const lines = text.split(/\r?\n/);
  let inFence = false;
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (/^\s*```/.test(line)) inFence = !inFence;

    const numbers = [...line.matchAll(NUMERIC)].map((match) => match[0]);
    const absolutes = [...line.matchAll(ABSOLUTE)].map((match) => match[0]);
    const params = [...line.matchAll(PARAM)].map((match) => match[1].toLowerCase());
    const figures = [...line.matchAll(FIGURE)].map((match) => match[0]);
    const media = [...line.matchAll(MEDIA)].map((match) => match[0]);

    const table = line.trim().startsWith("|")
      ? line.split("|").slice(1, -1).map((cell) => cell.trim())
      : null;
    const labelSetting = table && table.length >= 2 ? SETTING_BY_LABEL.get(normalizeCell(table[0])) : null;
    const comparison = labelSetting ? compareCell(labelSetting, table[1]) : null;

    const banned = BANNED.find((rule) => rule.re.test(line));
    const unknownParams = params.filter((name) => !PARAM_NAMES.has(name) && !RETIRED.has(name));
    const retiredParams = params.filter((name) => RETIRED.has(name));
    const unknownFigures = figures.filter((id) => !FIGURE_IDS.has(id));
    const missingMedia = media.filter((ref) => !mediaExists(ref));

    if (!numbers.length && !absolutes.length && !params.length && !figures.length && !media.length
      && !comparison && !banned) return;

    let status = "unverified";
    let severity = "P1";
    let expected = null;
    let evidence = null;

    if (banned) {
      status = "wrong";
      severity = banned.severity;
      expected = banned.expected;
      evidence = banned.evidence;
    } else if (comparison && !comparison.ok) {
      status = "wrong";
      severity = "P0";
      expected = String(comparison.expected);
      evidence = `${labelSetting.source}（${labelSetting.key}）`;
    } else if (unknownFigures.length) {
      status = "unknown-figure";
      severity = "P0";
      expected = "figures.json 中存在该 id";
      evidence = "tools/capture/figures.json";
    } else if (unknownParams.length) {
      status = "unknown-param";
      severity = "P0";
      expected = `已知参数之一：${[...PARAM_NAMES].join(", ")}`;
      evidence = "src/annotations.js";
    } else if (missingMedia.length) {
      status = "missing-media";
      severity = "P0";
      expected = "docs/public 下存在该文件";
      evidence = "docs/public/media";
    } else if (retiredParams.length) {
      status = "retired-param";
      severity = "P2";
      expected = "该参数已废弃，仅原样保留、不再生效";
      evidence = "src/annotations.js:6";
    } else if (comparison) {
      status = "ok";
      severity = "P2";
      expected = String(comparison.expected);
      evidence = `${labelSetting.source}（${labelSetting.key}）`;
    }

    add({
      surface,
      line: lineNumber,
      inFence,
      text: line.trim().slice(0, 300),
      types: [
        numbers.length ? "numeric" : null,
        absolutes.length ? "absolute" : null,
        params.length ? "param" : null,
        figures.length ? "figure" : null,
        media.length ? "media" : null,
        table ? "table" : null
      ].filter(Boolean),
      numbers,
      absolutes,
      params: [...new Set(params)],
      figures,
      media,
      status,
      severity,
      expected,
      evidence
    });
  });
}

// figures.json descriptions are claims too, but they live in JSON.
const figuresPath = join(ROOT, "tools", "capture", "figures.json");
const figureJson = readFileSync(figuresPath, "utf8").split(/\r?\n/);
for (const [index, line] of figureJson.entries()) {
  const match = /"id":\s*"(AG-[SAVP]\d{2}-\d{2}[ab]?)"/.exec(line);
  const descLine = figureJson.slice(index, index + 12).find((candidate) => candidate.includes('"desc"'));
  if (!match || !descLine) continue;
  const desc = /"desc":\s*"([^"]*)"/.exec(descLine)?.[1] ?? "";
  if (!desc) continue;
  const numbers = [...desc.matchAll(NUMERIC)].map((item) => item[0]);
  const absolutes = [...desc.matchAll(ABSOLUTE)].map((item) => item[0]);
  const params = [...desc.matchAll(PARAM)].map((item) => item[1].toLowerCase());
  add({
    surface: "tools/capture/figures.json",
    line: index + 1,
    inFence: false,
    text: `${match[1]}: ${desc}`,
    types: ["figure-desc", numbers.length ? "numeric" : null, absolutes.length ? "absolute" : null].filter(Boolean),
    numbers,
    absolutes,
    params,
    figures: [],
    media: [],
    status: "unverified",
    severity: "P1",
    expected: null,
    evidence: "tools/capture/figures.json"
  });
}

function mediaExists(ref) {
  const clean = ref.split(/[)"'\s]/)[0].replace(/^\/media\//, "");
  if (!clean) return false;
  const base = join(DOCS, "docs", "public", "media", clean);
  if (existsSync(base)) return true;
  const id = clean.match(/(AG-[SAVP]\d{2}-\d{2}[ab]?)\./)?.[1];
  if (!id) return false;
  const families = ["stills", "motion", "posters"];
  return families.some((family) => existsSync(join(DOCS, "docs", "public", "media", family))
    && readdirSync(join(DOCS, "docs", "public", "media", family)).some((file) => file.startsWith(`${id}.`)));
}

const stats = {
  surfaces: surfaces.length,
  lines: surfaces.reduce((total, item) => total + readFileSync(item.path, "utf8").split(/\r?\n/).length, 0),
  claims: claims.length,
  byStatus: tally(claims, (claim) => claim.status),
  bySeverity: tally(claims, (claim) => claim.severity),
  byType: tally(claims.flatMap((claim) => claim.types), (type) => type),
  bySurface: tally(claims, (claim) => claim.surface.split("/")[0] || claim.surface)
};

function tally(items, key) {
  const out = {};
  for (const item of items) {
    const value = key(item);
    out[value] = (out[value] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
}

const output = {
  version: 1,
  generatedAt: new Date().toISOString(),
  factsCommit: facts.plugin.commit,
  stats,
  claims
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log(JSON.stringify({
  out: OUT,
  stats,
  wrong: claims.filter((claim) => claim.status === "wrong").slice(0, 12).map((claim) => ({
    id: claim.id,
    surface: claim.surface,
    line: claim.line,
    status: claim.status,
    expected: claim.expected
  }))
}, null, 2));
