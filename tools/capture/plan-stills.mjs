#!/usr/bin/env node
// Turn the measured section envelopes into per-figure capture heights.
//
//   bash tools/capture/run.sh audit-sections.js > out/sections.json   # first
//   node tools/capture/plan-stills.mjs
//
// audit-sections.js measures the notes listed in the vault's .ag-args.json
// (`{"list": [...]}`) and returns them as JSON; without that field it returns
// `{}` and looks like "no data".
//
// A still is exactly as tall as its section. There is no minimum: a 180px
// section produces a 180px still, because padding it up to 360px only adds
// background. Sections taller than MAX must be split in figures.json — the
// planner reports them instead of silently truncating.
//
// Interface shots (kind: ui) are not planned here: they are cropped to an
// element and scaled to 1500 wide by the scene that captures them.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const MAX = 1700;

const figuresPath = path.join(here, "figures.json");
const sectionsPath = path.join(here, "out", "sections.json");
if (!existsSync(sectionsPath)) {
  console.error("缺少 tools/capture/out/sections.json，先跑 audit-sections.js");
  process.exit(1);
}

const measured = JSON.parse(readFileSync(sectionsPath, "utf8").replace(/^=>\s*/, ""));
const figures = JSON.parse(readFileSync(figuresPath, "utf8")).items;

const plan = [];
for (const figure of figures) {
  if (figure.media !== "still" || figure.kind) continue;
  const note = measured[figure.note];
  if (!note?.sections) {
    plan.push({ id: figure.id, note: figure.note, mode: "missing", reason: String(note ?? "no measurement") });
    continue;
  }

  let start = 0;
  let lastBottom = note.docEnd;
  if (figure.from) {
    // "行高上限" also matches the H1 "行高上限与孤儿"; prefer an exact h2/h3.
    // Prefer an exact heading below h1, then any heading below h1, then anything.
    const candidates = note.sections.filter((item) => item.text.includes(figure.from));
    const section = candidates.find((item) => item.level >= 2 && item.text === figure.from)
      ?? candidates.find((item) => item.level >= 2)
      ?? candidates[0];
    if (!section) {
      plan.push({ id: figure.id, note: figure.note, mode: "anchor-missing", reason: figure.from });
      continue;
    }
    start = section.start;
    lastBottom = section.lastBottom;
  } else {
    // From the document top: the title belongs in the frame, so start at 0.
    // `extentCss` is only an upper bound here — shoot.js measures the closing
    // heading live, because a section's real height depends on images that are
    // still decoding when this plan is written.
    start = 0;
    lastBottom = note.docEnd;
  }

  const extentCss = Math.max(40, Math.round(lastBottom - start));
  plan.push({
    id: figure.id,
    note: figure.note,
    from: figure.from ?? null,
    to: figure.to ?? null,
    page: figure.page,
    start,
    extentCss,
    mode: extentCss > MAX ? "too-tall" : "section"
  });
}

writeFileSync(path.join(here, "out", "plan.json"), `${JSON.stringify(plan, null, 2)}\n`, "utf8");

const ok = plan.filter((item) => item.mode === "section");
const broken = plan.filter((item) => item.mode !== "section");
console.log(`计划 ${plan.length} 张，可用 ${ok.length}，需处理 ${broken.length}`);
if (ok.length) {
  const heights = ok.map((item) => item.extentCss).sort((a, b) => a - b);
  console.log(`高度 ${heights[0]}–${heights.at(-1)} CSS，中位数 ${heights[Math.floor(heights.length / 2)]}`);
  const tall = ok.filter((item) => item.extentCss > 1100);
  if (tall.length) console.log(`偏长（>1100）：${tall.map((i) => `${i.id}(${i.extentCss})`).join(" ")}`);
}
for (const item of broken) console.log(`  ! ${item.id} ${item.mode} ${item.reason ?? ""}`);
