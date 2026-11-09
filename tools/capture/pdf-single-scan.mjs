#!/usr/bin/env node
// Find the spacer height where a single image is pushed with optimisation off
// and shrinks onto the page with it on.
//
//   node tools/capture/pdf-single-scan.mjs 500 600 700
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { prepare, restore, sleep, pageEval, reloadPlugin, VAULT } from "./winapp/lib/scene.mjs";

const BASE = readFileSync(join(VAULT, "fixtures", "pdf-single-spacer.md"), "utf8");
const TARGET = join(VAULT, "fixtures", "pdf-single-spacer-run.md");
const OUT = join(VAULT, ".cache", "pdf-single");
mkdirSync(OUT, { recursive: true });

const withSpacer = (h) => BASE.replace("<!-- SPACER -->", `<div style="height:${h}px"></div>`);
const STATES = {
  off: { headingBreakEnabled: false, imageOptimizationEnabled: false, singleImageMaxShrink: 0, orphanControlEnabled: false },
  images: { headingBreakEnabled: false, imageOptimizationEnabled: true, singleImageMaxShrink: 0.3, orphanControlEnabled: false }
};
const heights = process.argv.slice(2).map(Number).filter(Number.isFinite);
const candidates = heights.length ? heights : [500, 600, 700];

const imagePage = (file) => {
  const out = execFileSync("pdfimages", ["-list", file], { encoding: "utf8" });
  for (const line of out.split("\n").slice(2)) {
    const page = Number(line.trim().split(/\s+/)[0]);
    if (Number.isFinite(page)) return page;
  }
  return 0;
};

writeFileSync(TARGET, withSpacer(candidates[0]), "utf8");
const ctx = await prepare({ note: "fixtures/pdf-single-spacer-run.md", mode: "source", calibrate: false, background: true });
const hits = [];

for (const h of candidates) {
  const content = withSpacer(h);
  writeFileSync(TARGET, content, "utf8");
  await pageEval(`const p="fixtures/pdf-single-spacer-run.md"; const leaf=app.workspace.getLeavesOfType("markdown").find((l)=>l.view?.file?.path===p); if (leaf?.view?.editor) leaf.view.editor.setValue(${JSON.stringify(content)}); const f=app.vault.getAbstractFileByPath(p); await app.workspace.getLeaf(false).openFile(f); return true;`);
  await sleep(500);
  const entry = { height: h };
  for (const [name, state] of Object.entries(STATES)) {
    await reloadPlugin();
    await pageEval(`
      const plugin = app.plugins.plugins["obsidian-autogallery"];
      plugin.settings.pdfPagination = { ...plugin.settings.pdfPagination, ${Object.entries(state).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ")} };
      await plugin.saveSettings();
      return true;
    `);
    const file = join(OUT, `h${h}-${name}.pdf`).replace(/\\/g, "/");
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
    const clicked = await pageEval(`const b=[...document.querySelectorAll(".modal-container button")].find((n)=>n.textContent.trim()==="导出 PDF"); b?.click(); return Boolean(b);`);
    if (!clicked) throw new Error("找不到导出按钮");
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
    entry[name] = existsSync(file) ? { imagePage: imagePage(file) } : null;
  }
  entry.hit = Boolean(entry.off && entry.images && entry.off.imagePage === 2 && entry.images.imagePage === 1);
  if (entry.hit) hits.push(h);
  console.log(JSON.stringify(entry));
}

await restore(ctx);
console.log(JSON.stringify({ hits }));
