#!/usr/bin/env node
// Four-cell inventory: for every figure, which of zh/en × dark/light exists.
//
//   node tools/docs/matrix.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { variants } from "../capture/lib/media.mjs";
import { resolveVault } from "../capture/lib/vault.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const figures = JSON.parse(readFileSync(join(ROOT, "tools", "capture", "figures.json"), "utf8"));
const vault = resolveVault();
const manifest = JSON.parse(readFileSync(join(vault, "media", "manifest.json"), "utf8"));

const byCell = new Map();
for (const item of manifest.items) {
  byCell.set(`${item.id}/${item.lang}/${item.theme}`, item);
}

const CELLS = ["zh/dark", "zh/light", "en/dark", "en/light", "zh/any", "en/any"];
const counts = new Map(CELLS.map((cell) => [cell, { done: 0, total: 0 }]));
const gapIds = new Set();

function mark(item, lang, theme) {
  const row = byCell.get(`${item.id}/${lang}/${theme}`);
  return row && row.status !== "planned" && row.file ? "●" : "○";
}

function mechanism(item) {
  if (item.kind === "pdf") return "PDF 渲染";
  if (item.media === "still") return "CDP 静帧";
  return "winapp 动效";
}

const rows = [];
for (const item of figures.items) {
  const cells = variants(item);
  const marks = cells.map(({ lang, theme }) => {
    const key = `${lang}/${theme}`;
    const bucket = counts.get(key);
    if (bucket) {
      bucket.total += 1;
      if (mark(item, lang, theme) === "●") bucket.done += 1;
    }
    return mark(item, lang, theme);
  });
  if (marks.some((glyph) => glyph === "○")) gapIds.add(item.id);
  const label = cells.map(({ lang, theme }) => `${lang}/${theme}`).join(" ");
  rows.push(`| \`${item.id}\` | \`${item.page}\` | ${item.media} | ${mechanism(item)} | ${label} | ${marks.join("")} |`);
}

const cellRows = CELLS.map((cell) => {
  const bucket = counts.get(cell) ?? { done: 0, total: 0 };
  return `| \`${cell}\` | ${bucket.done}/${bucket.total} |`;
});

const gaps = [...gapIds].sort().map((id) => {
  const item = figures.items.find((entry) => entry.id === id);
  const missing = variants(item)
    .filter(({ lang, theme }) => mark(item, lang, theme) === "○")
    .map(({ lang, theme }) => `${lang}/${theme}`);
  return `- \`${id}\`（${item.page}，${mechanism(item)}）：缺 ${missing.join("、")}`;
});

const doc = `# 四格素材矩阵

> 由 \`node tools/docs/matrix.mjs\` 生成。数据来源：\`figures.json\`（应有什么）
> 与内部 \`demo/media/manifest.json\`（实际有什么）。

## 分格完成度

| 格 | 已产出 |
| --- | --- |
${cellRows.join("\n")}

图例：\`●\` 已产出，\`○\` 待产出。主题无关的素材只有 \`any\` 一格。

## 逐条状态

| 编号 | 页面 | 媒介 | 拍摄方式 | 格子 | 状态 |
| --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

## 缺口（${gapIds.size} 条）

${gaps.join("\n") || "- 无"}
`;

writeFileSync(join(ROOT, "audit", "matrix.md"), doc, "utf8");
const total = CELLS.reduce((sum, cell) => sum + (counts.get(cell)?.total ?? 0), 0);
const done = CELLS.reduce((sum, cell) => sum + (counts.get(cell)?.done ?? 0), 0);
console.log(`matrix.md: ${figures.items.length} 条素材 · ${done}/${total} 格已产出 · ${gapIds.size} 条有缺口`);
