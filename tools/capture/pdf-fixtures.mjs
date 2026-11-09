#!/usr/bin/env node
// Export the pagination fixture twice: every optimisation off, then on.
//
//   node tools/capture/pdf-fixtures.mjs
//
// The PDFs are the source of the AG-S19-* stills and of the AG-V19-01 clip, and
// they ship in the demo vault so a reader can compare the two layouts directly.
//
// The save dialog is patched for the duration of the run: it is the only part of
// the export that needs a human, and the path is fixed here anyway.
import { spawnSync } from "node:child_process";
import { existsSync, statSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { prepare, restore, sleep, pageEval, reloadPlugin, VAULT } from "./winapp/lib/scene.mjs";
import { posterId } from "./lib/media.mjs";

const NOTE = process.argv[2] ?? "fixtures/pdf-pagination.md";
const PREFIX = process.argv[3] ?? "pagination";
const LANG = process.argv[4] ?? "zh";
const OUT_DIR = join(VAULT, "media", LANG, "any", "pdf");
mkdirSync(OUT_DIR, { recursive: true });

const STATES = {
  off: {
    headingBreakEnabled: false,
    headingBreakLevel: 2,
    imageOptimizationEnabled: false,
    singleImageMaxShrink: 0,
    orphanControlEnabled: false
  },
  images: {
    headingBreakEnabled: false,
    headingBreakLevel: 2,
    imageOptimizationEnabled: true,
    singleImageMaxShrink: 0.3,
    orphanControlEnabled: false
  },
  heading: {
    headingBreakEnabled: true,
    headingBreakLevel: 2,
    imageOptimizationEnabled: false,
    singleImageMaxShrink: 0,
    orphanControlEnabled: false
  },
  orphan: {
    headingBreakEnabled: false,
    headingBreakLevel: 2,
    imageOptimizationEnabled: false,
    singleImageMaxShrink: 0,
    orphanControlEnabled: true,
    orphanMaxLines: 2
  }
};

const ctx = await prepare({ note: NOTE, mode: "source", calibrate: false, background: true });

const results = [];
for (const [name, pagination] of Object.entries(STATES)) {
  // A modal left behind by an earlier run keeps the exporter's session alive and
  // the next open silently does nothing.
  await reloadPlugin();
  const applied = await pageEval(`
    const plugin = app.plugins.plugins["obsidian-autogallery"];
    plugin.settings.pdfPagination = { ...plugin.settings.pdfPagination, ${Object.entries(pagination).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(", ")} };
    await plugin.saveSettings();
    return plugin.settings.pdfPagination;
  `);

  const target = join(OUT_DIR, `${PREFIX}-${name}.pdf`).replace(/\\/g, "/");
  await pageEval(`app.commands.executeCommandById("obsidian-autogallery:export-pdf"); return true;`);
  for (let i = 0; i < 60; i++) {
    const ready = await pageEval(`const s=document.querySelector(".ag-pdf-export__sheet"); return !!(s && s.offsetHeight > 100);`);
    if (ready) break;
    await sleep(300);
  }
  await sleep(500);

  const patched = await pageEval(`
    const electron = window.electron;
    const dialog = electron?.remote?.dialog ?? electron?.dialog;
    if (!dialog?.showSaveDialog) return false;
    window.__agSave = dialog.showSaveDialog;
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: ${JSON.stringify(target)} });
    return true;
  `);
  if (!patched) throw new Error("无法接管保存对话框");

  const clicked = await pageEval(`const b=[...document.querySelectorAll(".modal-container button")].find((n)=>n.textContent.trim()==="导出 PDF"); b?.click(); return Boolean(b);`); if (!clicked) throw new Error("找不到导出按钮");
  for (let i = 0; i < 60; i++) {
    if (existsSync(target) && statSync(target).size > 10000) break;
    await sleep(500);
  }

  await pageEval(`
    const electron = window.electron;
    const dialog = electron?.remote?.dialog ?? electron?.dialog;
    if (dialog && window.__agSave) dialog.showSaveDialog = window.__agSave;
    return true;
  `).catch(() => {});
  await sleep(800);

  results.push({ name, target, bytes: existsSync(target) ? statSync(target).size : null, applied });
  await sleep(600);
}

await restore(ctx);
console.log(JSON.stringify(results, null, 1));
