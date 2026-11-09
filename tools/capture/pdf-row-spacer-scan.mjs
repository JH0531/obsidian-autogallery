#!/usr/bin/env node
// Tune a spacer's pixel height to leave a partial page for a gallery row.
// Text lines quantise the remaining space (a line either fits or moves), so a
// spacer is the only way to land the row 100–190px above the page bottom.
//
//   node tools/capture/pdf-row-spacer-scan.mjs 0 20 40 60
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { prepare, restore, sleep, pageEval, reloadPlugin, VAULT } from "./winapp/lib/scene.mjs";

const BASE = readFileSync(join(VAULT, "fixtures", "pdf-row-spacer.md"), "utf8");
const TARGET = join(VAULT, "fixtures", "pdf-row-spacer-run.md");
const OUT = join(VAULT, ".cache", "pdf-row-spacer");
mkdirSync(OUT, { recursive: true });

const withSpacer = (height) => BASE.replace("<!-- SPACER -->", `<div style="height:${height}px"></div>`);
const STATES = {
  off: { headingBreakEnabled: false, headingBreakLevel: 2, imageOptimizationEnabled: false, singleImageMaxShrink: 0, orphanControlEnabled: false },
  images: { headingBreakEnabled: false, headingBreakLevel: 2, imageOptimizationEnabled: true, singleImageMaxShrink: 0.3, orphanControlEnabled: false }
};
const candidates = process.argv.slice(2).map(Number).filter(Number.isFinite);
const heights = candidates.length ? candidates : [0, 20, 40, 60];

const imagePages = (file) => {
  const out = spawnSync("pdfimages", ["-list", file], { encoding: "utf8" }).stdout ?? "";
  const pages = [];
  for (const line of out.split("\n").slice(2)) {
    const page = Number(line.trim().split(/\s+/)[0]);
    if (Number.isFinite(page)) pages.push(page);
  }
  return pages;
};

writeFileSync(TARGET, withSpacer(0), "utf8");
const ctx = await prepare({ note: "fixtures/pdf-row-spacer-run.md", mode: "source", calibrate: false, background: true });
const rows = [];

for (const height of heights) {
  const content = withSpacer(height);
  writeFileSync(TARGET, content, "utf8");
  await pageEval(`const p="fixtures/pdf-row-spacer-run.md"; const leaf=app.workspace.getLeavesOfType("markdown").find((l)=>l.view?.file?.path===p); if (leaf?.view?.editor) leaf.view.editor.setValue(${JSON.stringify(content)}); const f=app.vault.getAbstractFileByPath(p); await app.workspace.getLeaf(false).openFile(f); return true;`);
  await sleep(600);
  const entry = { height };
  for (const [name, pagination] of Object.entries(STATES)) {
    await reloadPlugin();
    await pageEval(`
      const plugin = app.plugins.plugins["obsidian-autogallery"];
      plugin.settings.pdfPagination = { ...plugin.settings.pdfPagination, ${Object.entries(pagination).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ")} };
      await plugin.saveSettings();
      return true;
    `);
    const file = join(OUT, `h${height}-${name}.pdf`).replace(/\\/g, "/");
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
    const clicked = await pageEval(`const b=[...document.querySelectorAll(".modal-container button")].find((n)=>n.textContent.trim()==="导出 PDF"); b?.click(); return Boolean(b);`); if (!clicked) throw new Error("找不到导出按钮");
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
    await sleep(400);
    const pages = existsSync(file) ? imagePages(file) : [];
    entry[name] = { page1: pages.filter((p) => p === 1).length, pages };
  }
  entry.hit = entry.off.page1 === 0 && entry.images.page1 >= 3;
  rows.push(entry);
  console.log(JSON.stringify(entry));
}

await restore(ctx);
console.log(JSON.stringify({ hits: rows.filter((r) => r.hit).map((r) => r.height) }));
