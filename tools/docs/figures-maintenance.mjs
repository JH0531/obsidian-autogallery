#!/usr/bin/env node
// Idempotent corrections to figures.json that the audit proved.
//
//   node tools/docs/figures-maintenance.mjs [--check]
//
// `--check` reports what would change without writing, so CI can catch a
// hand-edited regression. The file is re-serialised with the same 2-space
// layout it already uses; a round-trip with no corrections is byte-identical.
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const FILE = join(ROOT, "tools", "capture", "figures.json");
const CHECK = process.argv.includes("--check");

const DEFERRED = [
  ["AG-S12-04", "裁剪对话框静帧：控件由参数页文字覆盖，对话框在裁剪动效中可见"],
  ["AG-A13-01", "裁剪全流程动效：需窗口录制；本轮以 AG-S12-01..03 静帧与裁剪页文字覆盖"],
  ["AG-A07-01", "拖分隔条动效：需原生输入注入；手势页文字与 AG-S06-01/02 静帧覆盖"],
  ["AG-A07-02", "拖行高横条动效：同上"],
  ["AG-V07-01", "锁定整行动效：同上"],
  ["AG-A10-01", "拖角标动效：同上"],
  ["AG-V10-01", "对齐箭头动效：同上"],
  ["AG-S14-01", "说明与布局对话框：已由对话框页五项表格与 AG-S13-01 覆盖"],
  ["AG-S15-01", "配置管理可操作区：设置页已由 AG-S20-01 覆盖"],
  ["AG-S18-01", "PDF 导出对话框：本轮分页专题以 PDF 渲染对照为准，对话框由导出页文字覆盖"],
  ["AG-V18-01", "版式/分页预览切换动效：本轮暂缓，分页页以 5 张静帧覆盖"],
  ["AG-V19-01", "分页预览逐项开关动效：本轮以 AG-S19-01..05 静帧覆盖"],
  ["AG-S20-01", "设置页七分区目录：设置页文字与搜索说明已足够"],
  ["AG-A20-01", "目录搜索实时收敛动效：快捷键与行为表已覆盖"],
  ["AG-A20-02", "目录搜索全流程动效：同上"],
  ["AG-S22-01", "命令面板四条命令：命令表已覆盖"],
  ["AG-S22-02", "恢复默认二次确认：命令页文字已覆盖"]
];

const data = JSON.parse(readFileSync(FILE, "utf8"));
const changes = [];

function note(message) {
  changes.push(message);
}

if (data.note?.includes("文档站 25 页")) {
  data.note = data.note.replace("文档站 25 页", "文档站 26 页");
  note("note: 25 页 → 26 页");
}

for (const item of data.items) {
  if (/^AG-S19-0[1-5]$/.test(item.id) && !item.noteEn) {
    const kind = { "AG-S19-01": "row", "AG-S19-02": "single", "AG-S19-03": "heading", "AG-S19-04": "orphan", "AG-S19-05": "float" }[item.id];
    item.noteEn = `fixtures/pdf-pagination-${kind}.en.md`;
    note(`${item.id}: 补 noteEn（英文夹具溯源）`);
  }
}

// The orphan and float comparisons are new: the original list stopped at the
// heading rule, which left two of the five pagination rules without evidence.
for (const [id, kind, desc] of [
  ["AG-S19-04", "orphan", "PDF 排版对比：关闭孤行控制时末页只剩两行；开启后上一页末几行被带回，总页数少一页"],
  ["AG-S19-05", "float", "PDF 排版对比：共享浮动空间时正文留在本页、图片换页；按行文顺序对齐时图与旁文一起换页"]
]) {
  if (!data.items.some((item) => item.id === id)) {
    const anchor = data.items.findIndex((item) => item.id === "AG-S19-03");
    data.items.splice(anchor + 1, 0, {
      id,
      media: "still",
      page: "export/pagination",
      note: "18-PDF分页.md",
      noteEn: `fixtures/pdf-pagination-${kind}.en.md`,
      from: null,
      to: null,
      desc,
      kind: "pdf",
      theme: "any"
    });
    note(`${id}: 新增（${kind} 对照）`);
  }
}

const s1901 = data.items.find((item) => item.id === "AG-S19-01");
if (s1901 && s1901.desc.includes("整行压缩贴底")) {
  s1901.desc = "PDF 排版对比：关闭时整行被推到下一页、页尾留白；开启后整行同比例缩小、栏宽不变、贴住页脚";
  note("AG-S19-01: desc 改为「整行同比例缩小、栏宽不变」");
}

for (const item of data.items) {
  if (item.page === "templates/transfer") {
    item.page = "templates/import";
    note(`${item.id}: page templates/transfer → templates/import`);
  }
}

data.meta = data.meta ?? {};
if (data.meta.pdfFixtures && !data.meta.pdfFixtures.includes("pdf-stills.mjs")) {
  data.meta.pdfFixtures = "PDF 对照素材来自 fixtures/pdf-pagination*.md：pdf-stills.mjs 导出开关两版 PDF 到 media/<lang>/any/pdf/，再用 pdftoppm 渲页、magick 拼板并编码 WebP；每张图写盘前先过页号/图片数断言";
  note("meta.pdfFixtures: 指向可复跑的 pdf-stills.mjs");
}
if (data.meta.posters && !data.meta.posters.includes("1200×800")) {
  data.meta.posters += "；文档站当前另用静态 JPG 1200×800 作为首帧回退（AG-P00-01.jpg）";
  note("meta.posters: 补静态 JPG 回退说明");
}
if (data.meta.noteEn && !data.meta.noteEn.includes("kind: pdf")) {
  data.meta.noteEn += "；kind 为 pdf 时 note/noteEn 是溯源标签，实际拍摄源是 fixtures/pdf-pagination-*.md";
  note("meta.noteEn: 说明 pdf 类的 noteEn 语义");
}

if (!Array.isArray(data.deferred)) {
  data.deferred = DEFERRED.map(([id, reason]) => ({ id, reason }));
  note(`deferred: 登记 ${data.deferred.length} 条暂缓项`);
} else {
  for (const [id, reason] of DEFERRED) {
    if (!data.deferred.some((entry) => entry.id === id)) {
      data.deferred.push({ id, reason });
      note(`deferred: 补 ${id}`);
    }
  }
}

const serialized = `${JSON.stringify(data, null, 2)}\n`;
const current = readFileSync(FILE, "utf8");

if (CHECK) {
  console.log(changes.length ? changes.map((line) => `- ${line}`).join("\n") : "figures.json 已是修正后的状态");
  process.exit(changes.length ? 1 : 0);
}

if (serialized !== current) writeFileSync(FILE, serialized, "utf8");
console.log(changes.length ? changes.map((line) => `- ${line}`).join("\n") : "无需修改");
