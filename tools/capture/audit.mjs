#!/usr/bin/env node
// Regenerate audit.md from figures.json and the vault manifest.
//
//   node tools/capture/audit.mjs
//
// The table is derived, not written by hand: the figure list is the source of
// truth for what should exist, the manifest for what does. Anything that only
// lives in prose drifts within a week.
//
// Every figure exists in four cells (language × theme). The status column shows
// those four cells as a row of glyphs in matrix order, so a figure that is
// "done" in one cell can no longer read as done.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveVault } from "./lib/vault.mjs";
import { variants } from "./lib/media.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const figures = JSON.parse(readFileSync(join(HERE, "figures.json"), "utf8"));
const vault = resolveVault();
const manifestPath = join(vault, "media", "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { items: [] };
// The cells that exist in the manifest. Theme-independent figures contribute a
// single `any` cell per language, so this cannot be the full matrix.
const CELLS = [...new Set(manifest.items.map((item) => `${item.lang}/${item.theme}`))].sort();

const rowsOf = (id) => manifest.items.filter((item) => item.id === id);
const done = (item) => item && item.status !== "planned";
const deferred = new Map((figures.deferred || []).map((entry) => [entry.id, entry.reason]));

const statusOf = (id) => {
  const rows = rowsOf(id);
  if (!rows.length) return "未登记";
  const entry = figures.items.find((item) => item.id === id);
  const cells = variants(entry);
  const byCell = new Map(rows.map((row) => [`${row.lang}/${row.theme}`, row]));
  const marks = cells.map(({ lang, theme }) => (done(byCell.get(`${lang}/${theme}`)) ? "●" : "○"));
  const filled = marks.filter((mark) => mark === "●").length;
  return `${marks.join("")} ${filled}/${cells.length}`;
};

const byPage = new Map();
for (const item of figures.items) {
  if (!byPage.has(item.page)) byPage.set(item.page, []);
  byPage.get(item.page).push(item);
}

const rows = [];
for (const [page, list] of [...byPage.entries()].sort()) {
  list.forEach((item, i) => {
    const anchor = item.from || item.to
      ? [item.from && `从「${item.from}」`, item.to && `到「${item.to}」`].filter(Boolean).join("，")
      : "—";
    rows.push(`| ${i === 0 ? `\`${page}\`` : ""} | ${i === 0 ? item.note : ""} | \`${item.id}\` | ${item.media} | ${anchor} | ${item.desc || "—"} | ${statusOf(item.id)}${deferred.has(item.id) ? "（暂缓）" : ""} |`);
  });
}

// Per-cell totals: the question "how far along is this variant" is asked more
// often than "how far along is this figure".
const matrixRows = CELLS.map((key) => {
  const cells = manifest.items.filter((item) => `${item.lang}/${item.theme}` === key);
  const still = cells.filter((item) => item.media === "still");
  const motion = cells.filter((item) => item.media !== "still");
  const count = (list) => `${list.filter(done).length}/${list.length}`;
  return `| \`${key}\` | ${count(still)} | ${count(motion)} | ${count(cells)} |`;
});

const pending = manifest.items.filter((item) => !done(item));
const pendingByCell = CELLS.map((key) => ({
  cell: key,
  list: pending.filter((item) => `${item.lang}/${item.theme}` === key)
}));

// One line per cell: 47 bullets per cell would bury the short, actionable cell
// (the one with six entries left) under the three empty ones.
const pendingLines = pendingByCell
  .filter((entry) => entry.list.length)
  .map((entry) => `- **${entry.cell}**（${entry.list.length}）：${entry.list.map((p) => `\`${p.id}\``).join("、")}`)
  .join("\n");

const textOnly = (figures.textOnly || [])
  .map((t) => `| \`${t.page}\` | ${t.note} | ${t.reason} |`);

const legend = CELLS.join(" → ");

const doc = `# 素材需求审计

> 由 \`node tools/capture/audit.mjs\` 生成，不要手改。数据来源：\`figures.json\`（应有什么）
> 与演示库 \`media/manifest.json\`（实际有什么）。

## 编号与版本

${figures.meta?.numbering ?? ""}

- ${figures.meta?.anchors ?? ""}
- ${figures.meta?.matrix ?? ""}
- ${figures.meta?.themes ?? ""}
- ${figures.meta?.kinds ?? ""}
- ${figures.meta?.noteEn ?? ""}

状态列的四格按 **${legend}** 排列：\`●\` 已产出，\`○\` 待产出。

## 版本矩阵

| 变体 | 静帧 | 动效 | 合计 |
| --- | --- | --- | --- |
${matrixRows.join("\n")}

## 页面 ↔ 素材映射

| 页面 | 笔记 | 编号 | 媒介 | 取景 | 说明 | 版本 |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join("\n")}

## 无素材页面

这些页面刻意不配图，不是遗漏：

| 页面 | 笔记 | 原因 |
| --- | --- | --- |
${textOnly.join("\n")}

## 待办

未产出的登记项共 ${pending.length} 条：

${pendingLines || "- 无"}

## 暂缓

下面这些项目前没有文件，但已明确本轮不拍。它们不计为「遗漏」；下一轮要么补拍，要么从 \`items\` 移入 \`retired\`。

| 编号 | 理由 |
| --- | --- |
${(figures.deferred || []).map((entry) => `| \`${entry.id}\` | ${entry.reason} |`).join("\n") || "| — | 无 |"}

## 已知重叠

| 组合 | 关系 | 处理 |
| --- | --- | --- |
| \`AG-S07-01\` / \`AG-A07-01\` / \`AG-A07-02\` | 同一节「四类手柄」，静帧讲外观、动效讲手势 | 保留，三张各答一个问题 |
| \`AG-S12-04\` / \`AG-A13-01\` | 同一对话框，静帧讲控件、动效讲流程 | 保留，动效不重复解释控件 |
| \`AG-S11-03\` / \`AG-V07-01\` | 「锁定整行」出现在参数速查与手势页 | 保留，前者是写法、后者是操作 |
| \`AG-S20-01/02/03\` | 同一设置页三张 | 用 \`desc\` 区分：目录 / 搜索计数 / 数值项与恢复默认 |
`;

writeFileSync(join(HERE, "audit.md"), doc, "utf8");
const filled = manifest.items.filter(done).length;
console.log(`audit.md: ${figures.items.length} 条素材，${manifest.items.length} 个版本格，已产出 ${filled}，待产出 ${pending.length}`);
