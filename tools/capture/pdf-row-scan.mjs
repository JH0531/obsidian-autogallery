#!/usr/bin/env node
// Find the filler length that puts a gallery row exactly on a page boundary.
//
//   node tools/capture/pdf-row-scan.mjs 8 9 10 11
//
// AG-S19-01 has to show a row being *pushed* to the next page with the
// optimisation off, and *compressed to fit* with it on. That only reads if the
// row sits at the page edge, and the row's distance from the edge depends on
// every line above it — so the amount of filler is a measured quantity, not a
// guess. For each candidate the fixture is regenerated, both PDFs are exported,
// and `pdfimages -list` says which page the pictures landed on.
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { prepare, restore, sleep, pageEval, reloadPlugin, VAULT } from "./winapp/lib/scene.mjs";

const BASE = readFileSync(join(VAULT, "fixtures", "pdf-pagination.md"), "utf8");
const TARGET = join(VAULT, "fixtures", "pdf-pagination-row.md");
const OUT = join(VAULT, ".cache", "pdf-row-scan");
mkdirSync(OUT, { recursive: true });

const FILLER = "分页判定以块为单位，一段连续的文字只要放得下就整段保留，放不下就整体下移；"
  + "只有当整段都超过一页时才会在段内断开。图片与画廊行是刚性块，允许按比例压缩，但不允许拆开。";

const withFiller = (k) => {
  if (!k) return BASE;
  const whole = Math.floor(k);
  const fraction = k - whole;
  const blocks = Array.from({ length: whole }, (_, i) => `${FILLER}（填充段 ${i + 1}）`);
  if (fraction > 0) {
    // A whole block is coarser than the compression window (~30% of the row
    // height). A partial paragraph lets the scan land inside it.
    const text = FILLER.repeat(3).slice(0, Math.max(12, Math.round(FILLER.length * fraction)));
    blocks.push(`${text}（填充段 ${whole + 1}）`);
  }
  return BASE.replace("## 第二段：画廊行", `${blocks.join("\n\n")}\n\n## 第二段：画廊行`);
};

const STATES = {
  off: { headingBreakEnabled: false, headingBreakLevel: 2, imageOptimizationEnabled: false, singleImageMaxShrink: 0, orphanControlEnabled: false },
  images: { headingBreakEnabled: false, headingBreakLevel: 2, imageOptimizationEnabled: true, singleImageMaxShrink: 0.3, orphanControlEnabled: false }
};

const counts = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const candidates = counts.length ? counts : [8, 10, 12];

// Page numbers of the pictures, per page. Empty for page 1 means the row moved.
const imagePages = (file) => {
  const out = spawnSync("pdfimages", ["-list", file], { encoding: "utf8" }).stdout ?? "";
  const pages = [];
  for (const line of out.split("\n").slice(2)) {
    const page = Number(line.trim().split(/\s+/)[0]);
    if (Number.isFinite(page)) pages.push(page);
  }
  return pages;
};

const ctx = await prepare({ note: "fixtures/pdf-pagination-row.md", mode: "source", calibrate: false, background: true });
const rows = [];

for (const k of candidates) {
  writeFileSync(TARGET, withFiller(k), "utf8");
  // The export command exports the active note. Writing the file is not
  // enough: the scan has to reopen it, otherwise every candidate exports the
  // same untouched fixture.
  await pageEval(`const f=app.vault.getAbstractFileByPath("fixtures/pdf-pagination-row.md"); await app.workspace.getLeaf(false).openFile(f); return true;`);
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
    if (existsSync(file)) { const { unlinkSync } = await import("node:fs"); unlinkSync(file); }
    await pageEval(`app.commands.executeCommandById("obsidian-autogallery:export-pdf"); return true;`);
    for (let i = 0; i < 60; i++) {
      const ready = await pageEval(`const s=document.querySelector(".ag-pdf-export__sheet"); return !!(s && s.offsetHeight > 100);`);
      if (ready) break;
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

    const clicked = await pageEval(`const b=[...document.querySelectorAll(".modal-container button")].find((n)=>n.textContent.trim()==="导出 PDF"); b?.click(); return Boolean(b);`); if (!clicked) throw new Error("找不到导出按钮");
    for (let i = 0; i < 60; i++) {
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
  // The row is on page 2 with the optimisation off, and still on page 1 with it on.
  entry.hit = entry.off.page1 === 0 && entry.images.page1 >= 3;
  rows.push(entry);
  console.log(JSON.stringify(entry));
}

await restore(ctx);
console.log(JSON.stringify({ hits: rows.filter((r) => r.hit).map((r) => r.filler) }));
