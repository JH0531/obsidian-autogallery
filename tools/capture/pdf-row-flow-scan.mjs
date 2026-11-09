#!/usr/bin/env node
// Find the filler length that puts a gallery row on a page boundary when the
// row is NOT preceded by a heading. `pdf-row-scan` inserts filler before a
// heading, which lets heading protection move the whole section; this scan
// inserts it at a marker directly above the row paragraph.
//
//   node tools/capture/pdf-row-flow-scan.mjs 4 6 8
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { prepare, restore, sleep, pageEval, clickText, reloadPlugin, VAULT } from "./winapp/lib/scene.mjs";

const BASE = readFileSync(join(VAULT, "fixtures", "pdf-row-flow.md"), "utf8");
const TARGET = join(VAULT, "fixtures", "pdf-row-flow-run.md");
const OUT = join(VAULT, ".cache", "pdf-row-flow");
mkdirSync(OUT, { recursive: true });

const FILLER = "分页判定以块为单位，一段连续的文字只要放得下就整段保留，放不下就整体下移；"
  + "图片与画廊行是刚性块，允许按比例压缩，但不允许拆开。";

const withFiller = (k) => {
  if (!k) return BASE;
  const whole = Math.floor(k);
  const fraction = k - whole;
  const blocks = Array.from({ length: whole }, (_, i) => `${FILLER}（填充段 ${i + 1}）`);
  if (fraction > 0) {
    const text = FILLER.repeat(3).slice(0, Math.max(12, Math.round(FILLER.length * fraction)));
    blocks.push(`${text}（填充段 ${whole + 1}）`);
  }
  return BASE.replace("<!-- FILLER -->", blocks.join("\n\n"));
};

const STATES = {
  off: { headingBreakEnabled: false, headingBreakLevel: 2, imageOptimizationEnabled: false, singleImageMaxShrink: 0, orphanControlEnabled: false },
  images: { headingBreakEnabled: false, headingBreakLevel: 2, imageOptimizationEnabled: true, singleImageMaxShrink: 0.3, orphanControlEnabled: false }
};

const candidates = process.argv.slice(2).map(Number).filter(Number.isFinite);
const counts = candidates.length ? candidates : [4, 6, 8];

const imagePages = (file) => {
  const out = spawnSync("pdfimages", ["-list", file], { encoding: "utf8" }).stdout ?? "";
  const pages = [];
  for (const line of out.split("\n").slice(2)) {
    const page = Number(line.trim().split(/\s+/)[0]);
    if (Number.isFinite(page)) pages.push(page);
  }
  return pages;
};

const ctx = await prepare({ note: "fixtures/pdf-row-flow-run.md", mode: "source" });
const rows = [];

for (const k of counts) {
  writeFileSync(TARGET, withFiller(k), "utf8");
  await pageEval(`const f=app.vault.getAbstractFileByPath("fixtures/pdf-row-flow-run.md"); await app.workspace.getLeaf(false).openFile(f); return true;`);
  await sleep(600);
  const entry = { filler: k };
  for (const [name, pagination] of Object.entries(STATES)) {
    await reloadPlugin();
    await pageEval(`
      const plugin = app.plugins.plugins["obsidian-autogallery"];
      plugin.settings.pdfPagination = { ...plugin.settings.pdfPagination, ${Object.entries(pagination).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ")} };
      await plugin.saveSettings();
      return true;
    `);
    const file = join(OUT, `k${k}-${name}.pdf`).replace(/\\/g, "/");
    if (existsSync(file)) unlinkSync(file);
    await pageEval(`app.commands.executeCommandById("obsidian-autogallery:export-pdf"); return true;`);
    for (let i = 0; i < 60; i += 1) {
      if (await pageEval(`const s=document.querySelector(".ag-pdf-export__sheet"); return !!(s && s.offsetHeight > 100)`)) break;
      await sleep(300);
    }
    await sleep(400);
    const patched = await pageEval(`
      const electron = window.electron;
      const dialog = electron?.remote?.dialog ?? electron?.dialog;
      if (!dialog?.showSaveDialog) return false;
      window.__agSave = dialog.showSaveDialog;
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(file)} });
      return true;
    `);
    if (!patched) throw new Error("无法接管保存对话框");
    await clickText(ctx, ".modal-container", "导出 PDF");
    for (let i = 0; i < 60; i += 1) {
      if (existsSync(file) && statSync(file).size > 10000) break;
      await sleep(400);
    }
    await pageEval(`
      const electron = window.electron;
      const dialog = electron?.remote?.dialog ?? electron?.dialog;
      if (dialog && window.__agSave) dialog.showSaveDialog = window.__agSave;
      return true;
    `).catch(() => {});
    await sleep(500);
    const pages = existsSync(file) ? imagePages(file) : [];
    entry[name] = { page1: pages.filter((p) => p === 1).length, pages };
  }
  entry.hit = entry.off.page1 === 0 && entry.images.page1 >= 3;
  rows.push(entry);
  console.log(JSON.stringify(entry));
}

await restore(ctx);
console.log(JSON.stringify({ hits: rows.filter((r) => r.hit).map((r) => r.filler) }));
