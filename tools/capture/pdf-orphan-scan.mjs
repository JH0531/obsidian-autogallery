#!/usr/bin/env node
// Find a paragraph length whose last page holds 1–2 lines, then export it with
// orphan control off/on. The hit is: off = 2 pages with <=2 lines on page 2,
// on = 1 page (those lines pulled back).
//
//   node tools/capture/pdf-orphan-scan.mjs 1700 1800 1900 2000
import { writeFileSync, existsSync, statSync, mkdirSync, unlinkSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { prepare, restore, sleep, pageEval, reloadPlugin, VAULT } from "./winapp/lib/scene.mjs";

const TARGET = join(VAULT, "fixtures", "pdf-orphan-run.md");
const OUT = join(VAULT, ".cache", "pdf-orphan");
mkdirSync(OUT, { recursive: true });

const SENTENCE = process.env.AG_LANG === "en"
  ? "Orphan control works on the last line of a paragraph: when only one line would land on the next page it pulls one more line across, so the page does not open with a lonely short line; the final layout is a stable state after several rounds of correction."
  : "孤行控制处理的是段落末行：如果段落只剩一行落在下一页，就把上一行一起带过去，避免页首出现一个孤零零的短行；分页结果是多轮修正后的稳定状态。";
const noteFor = (n) => `---\nrole: fixture\n---\n\n${SENTENCE.repeat(Math.ceil(n / SENTENCE.length)).slice(0, n)}\n`;

const STATES = {
  off: { headingBreakEnabled: false, imageOptimizationEnabled: false, singleImageMaxShrink: 0, orphanControlEnabled: false, orphanMaxLines: 2, lineHeightMaxShrink: 0.1 },
  orphan: { headingBreakEnabled: false, imageOptimizationEnabled: false, singleImageMaxShrink: 0, orphanControlEnabled: true, orphanMaxLines: 2, lineHeightMaxShrink: 0.1 }
};

const sizes = process.argv.slice(2).map(Number).filter(Number.isFinite);
const candidates = sizes.length ? sizes : [1700, 1800, 1900, 2000];

const pagesOf = (file) => {
  const text = execFileSync("pdfinfo", [file], { encoding: "utf8" });
  return Number(/Pages:\s+(\d+)/.exec(text)?.[1] ?? 0);
};
const linesOnPage2 = (file) => {
  if (pagesOf(file) < 2) return 0;
  const text = execFileSync("pdftotext", ["-f", "2", "-l", "2", "-layout", file, "-"], { encoding: "utf8" });
  return text.split("\n").filter((line) => line.trim()).length;
};

writeFileSync(TARGET, noteFor(candidates[0]), "utf8");
const ctx = await prepare({ note: "fixtures/pdf-orphan-run.md", mode: "source", calibrate: false, background: true });

const hits = [];
for (const n of candidates) {
  writeFileSync(TARGET, noteFor(n), "utf8");
  await pageEval(`const f=app.vault.getAbstractFileByPath("fixtures/pdf-orphan-run.md"); await app.workspace.getLeaf(false).openFile(f); return true;`);
  await sleep(500);
  const entry = { chars: n };
  for (const [name, pagination] of Object.entries(STATES)) {
    await reloadPlugin();
    await pageEval(`
      const plugin = app.plugins.plugins["obsidian-autogallery"];
      plugin.settings.pdfPagination = { ...plugin.settings.pdfPagination, ${Object.entries(pagination).map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(", ")} };
      await plugin.saveSettings();
      return true;
    `);
    const file = join(OUT, `n${n}-${name}.pdf`).replace(/\\/g, "/");
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
    entry[name] = existsSync(file) ? { pages: pagesOf(file), lines: linesOnPage2(file) } : { pages: 0, lines: 0 };
  }
  entry.hit = entry.off.pages === 2 && entry.off.lines > 0 && entry.off.lines <= 2 && entry.orphan.pages === 1;
  if (entry.hit) hits.push(n);
  console.log(JSON.stringify(entry));
}

await restore(ctx);
console.log(JSON.stringify({ hits }));
