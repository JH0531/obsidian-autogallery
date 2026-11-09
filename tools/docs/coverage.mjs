#!/usr/bin/env node
// Generate audit/coverage.md: every setting, parameter, command and figure
// mapped to a documentation page, with the gaps called out.
//
//   node tools/docs/coverage.mjs
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const DOCS = resolve(ROOT, "..", "obsidian_autogallery_docs", "docs", "zh");
const facts = JSON.parse(readFileSync(join(ROOT, "audit", "facts.json"), "utf8"));
const figures = JSON.parse(readFileSync(join(ROOT, "tools", "capture", "figures.json"), "utf8"));

function pages(dir, prefix = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...pages(full, prefix ? `${prefix}/${entry.name}` : entry.name));
    else if (entry.name.endsWith(".md")) {
      const name = entry.name.replace(/\.md$/, "");
      out.push({ slug: name === "index" ? (prefix || "index") : (prefix ? `${prefix}/${name}` : name), file: full });
    }
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

const pageList = pages(DOCS);
const pageBySlug = new Map(pageList.map((page) => [page.slug, page]));
const textOnly = new Map((figures.textOnly || []).map((entry) => [entry.page, entry.reason]));
// Pages that deliberately carry no figure of their own. Anything not listed
// here and without a registered figure is a real gap.
const NO_FIGURE = new Map([
  ["changelog", "版本历史，不需要图"],
  ["guide/install", "安装步骤，文字足够"],
  ["index", "首页复用 quick-start 的 AG-V00-01 / AG-P00-01，不单独登记"],
  ["reference/compatibility", "兼容性表格，不需要图"],
  ["export/troubleshooting", "排查步骤，文字足够"],
  ["templates/import", "规则文件格式，表格与 JSON 示例足够"]
]);
const figuresByPage = new Map();
for (const item of figures.items) {
  if (!figuresByPage.has(item.page)) figuresByPage.set(item.page, []);
  figuresByPage.get(item.page).push(item.id);
}

// Settings → the page that explains them. Keys are matched by prefix so a new
// setting in an existing group lands somewhere without a second table.
const SETTING_PAGE = [
  [/^language$/, "reference/settings"],
  [/^(imageCaptionGap|imageBottomMargin|textImageGap|mobileBreakpoint|captionItalic)$/, "gallery/handles"],
  [/^gallery/, "gallery/height"],
  [/^(widthGain|medianRatio|floatMax|dragWidth|dragAlignment)/, "single/width"],
  [/^pdf/, "export/dialog"],
  [/^(headingBreak|imageOptimization|singleImageMaxShrink|lineHeightMaxShrink|orphanControl|orphanMaxLines|floatSpace)/, "export/pagination"],
  [/^floatBreaks/, "single/float"],
  [/^(profiles|routes)/, "templates/routing"],
  [/^(debug|logLevel)/, "reference/settings"]
];

function pageFor(key) {
  for (const [pattern, slug] of SETTING_PAGE) if (pattern.test(key)) return slug;
  return "reference/settings";
}

function groups() {
  const map = new Map();
  for (const setting of facts.settings) {
    const slug = pageFor(setting.key);
    if (!map.has(slug)) map.set(slug, []);
    map.get(slug).push(setting);
  }
  return map;
}

const settingsByPage = groups();
const rows = [];
const gaps = [];

for (const page of pageList) {
  const text = readFileSync(page.file, "utf8");
  const headings = text.split(/\r?\n/).filter((line) => /^##\s+/.test(line)).length;
  const figs = figuresByPage.get(page.slug) ?? [];
  const reason = textOnly.get(page.slug) ?? NO_FIGURE.get(page.slug);
  rows.push(`| \`${page.slug}\` | ${headings} | ${figs.length} | ${figs.slice(0, 6).map((id) => `\`${id}\``).join(" ") || "—"} | ${reason ?? (figs.length ? "" : "需补图")} |`);
  if (!figs.length && !reason) gaps.push(page.slug);
}

const settingRows = [...settingsByPage.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([slug, list]) => `| \`${slug}\` | ${list.length} | ${list.map((item) => `\`${item.key}\``).join("、")} |`);

const params = facts.params.map((param) => `| \`ag:${param.name}\` | \`${param.syntax}\` | \`${param.source}\` |`);
const commands = (facts.commands?.registered ?? []).map((command) => `| \`${command.id}\` | ${command.labelZh} | ${command.source} |`);

const doc = `# 功能覆盖矩阵

> 由 \`node tools/docs/coverage.mjs\` 生成。数据来源：\`audit/facts.json\`（代码事实）、
> \`tools/capture/figures.json\`（素材登记）与 \`docs/zh\`（中文文档）。

## 总量

| 项 | 数量 |
| --- | --- |
| 中文页面 | ${pageList.length} |
| 设置项 | ${facts.settings.length} |
| \`ag:\` 参数 | ${facts.params.length} |
| 命令 | ${facts.commands?.registered?.length ?? 0} |
| 素材登记 | ${figures.items.length} |

## 页面 × 素材

| 页面 | 二级标题 | 素材数 | 素材 id | 状态 |
| --- | --- | --- | --- | --- |
${rows.join("\n")}

## 设置项落点

| 页面 | 设置数 | 键 |
| --- | --- | --- |
${settingRows.join("\n")}

## 参数

| 参数 | 语法 | 代码位置 |
| --- | --- | --- |
${params.join("\n")}

## 命令

| id | 标签 | 位置 |
| --- | --- | --- |
${commands.join("\n")}

## 缺口

${gaps.length ? gaps.map((slug) => `- \`${slug}\`：页面没有登记素材，也没有不配图的理由。`).join("\n") : "- 无未解释的零图页面。"}

- 英文素材：\`en/any\`、\`en/dark\`、\`en/light\` 仍为 0，四格拍摄从 T-203 开始。
- 设置项按页面聚合，不保证每个键都在正文出现；逐键核对由 \`check:docs\` 的设置表断言覆盖。
`;

writeFileSync(join(ROOT, "audit", "coverage.md"), doc, "utf8");
console.log(`coverage.md: ${pageList.length} 页 · ${facts.settings.length} 设置 · ${figures.items.length} 素材 · ${gaps.length} 个零图缺口`);
