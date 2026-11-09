#!/usr/bin/env node
// Find a filler length where floatSpaceMode ordered/share differ at a page edge.
//
//   node tools/capture/pdf-float-scan.mjs 2 3 4 5
//
// Hit: ordered keeps the float and its prose on the same page, share leaves the
// prose on the previous page while the float moves.
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { prepare, restore, sleep, pageEval, reloadPlugin, VAULT } from "./winapp/lib/scene.mjs";

const BASE = readFileSync(join(VAULT, "fixtures", "pdf-float.md"), "utf8");
const TARGET = join(VAULT, "fixtures", "pdf-float-run.md");
const OUT = join(VAULT, ".cache", "pdf-float");
mkdirSync(OUT, { recursive: true });

const EN = process.env.AG_LANG === "en";
const FILLER = EN
  ? "Pagination works on blocks, not characters: a paragraph stays whole while it fits and moves whole when it does not; images and gallery rows are rigid blocks that may shrink but never split."
  : "分页判定以块为单位，一段连续的文字只要放得下就整段保留，放不下就整体下移；图片与画廊行是刚性块，允许按比例压缩，但不允许拆开。";
const withFiller = (k) => BASE.replace("<!-- FILLER -->", Array.from({ length: k }, (_, i) => `${FILLER}（填充段 ${i + 1}）`).join("\n\n"));

const STATES = {
  ordered: { floatSpaceMode: "ordered", headingBreakEnabled: false, imageOptimizationEnabled: false, orphanControlEnabled: false },
  share: { floatSpaceMode: "share", headingBreakEnabled: false, imageOptimizationEnabled: false, orphanControlEnabled: false }
};

const counts = process.argv.slice(2).map(Number).filter(Number.isFinite);
const candidates = counts.length ? counts : [2, 3, 4, 5];

const pageCount = (file) => Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [file], { encoding: "utf8" }))?.[1] ?? 0);
const imagePage = (file) => {
  const out = execFileSync("pdfimages", ["-list", file], { encoding: "utf8" });
  for (const line of out.split("\n").slice(2)) {
    const page = Number(line.trim().split(/\s+/)[0]);
    if (Number.isFinite(page)) return page;
  }
  return 0;
};
const markerPage = (file) => {
  const pages = pageCount(file);
  for (let page = 1; page <= pages; page += 1) {
    const text = execFileSync("pdftotext", ["-f", String(page), "-l", String(page), "-layout", file, "-"], { encoding: "utf8" });
    if (text.includes(EN ? "ending at this point" : "到这里结束")) return page;
  }
  return 0;
};

writeFileSync(TARGET, withFiller(candidates[0]), "utf8");
const ctx = await prepare({ note: "fixtures/pdf-float-run.md", mode: "source", calibrate: false, background: true });
const hits = [];

for (const k of candidates) {
  writeFileSync(TARGET, withFiller(k), "utf8");
  await pageEval(`const f=app.vault.getAbstractFileByPath("fixtures/pdf-float-run.md"); await app.workspace.getLeaf(false).openFile(f); return true;`);
  await sleep(500);
  const entry = { filler: k };
  for (const [name, state] of Object.entries(STATES)) {
    await reloadPlugin();
    await pageEval(`
      const plugin = app.plugins.plugins["obsidian-autogallery"];
      plugin.settings.floatSpaceMode = ${JSON.stringify(state.floatSpaceMode)};
      plugin.settings.pdfPagination = { ...plugin.settings.pdfPagination, ${Object.entries(state).filter(([key]) => key !== "floatSpaceMode").map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ")} };
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
    entry[name] = existsSync(file) ? { floatPage: imagePage(file), prosePage: markerPage(file), pages: pageCount(file) } : null;
  }
  entry.hit = Boolean(entry.ordered && entry.share
    && entry.ordered.floatPage === entry.ordered.prosePage
    && entry.share.floatPage !== entry.share.prosePage);
  if (entry.hit) hits.push(k);
  console.log(JSON.stringify(entry));
}

await restore(ctx);
console.log(JSON.stringify({ hits }));
