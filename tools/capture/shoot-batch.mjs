#!/usr/bin/env node
// Shoot every content still that needs no dialog, preset or pointer gesture.
//
//   node tools/capture/shoot-batch.mjs                    # zh / dark, every eligible still
//   node tools/capture/shoot-batch.mjs --theme light      # the same figures, light cell
//   node tools/capture/shoot-batch.mjs --lang en          # needs noteEn in figures.json
//   node tools/capture/shoot-batch.mjs --only AG-S04-01 --force
//
// A figure is captured once per cell of the language × theme matrix and lands in
// media/<lang>/<theme>/stills/<id>.webp. Interface shots (settings, dialogs,
// command palette) and gesture frames are not here: they live in
// winapp/scenes/<ID>.mjs and are driven by run-ui.mjs.

import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveVault } from "./lib/vault.mjs";
import { DEFAULT_LANG, DEFAULT_THEME, assertVariant, stillRel, contentLangGaps } from "./lib/media.mjs";
import { setTheme } from "./lib/theme.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = resolveVault();
const figures = JSON.parse(readFileSync(path.join(here, "figures.json"), "utf8")).items;
const planPath = path.join(here, "out", "plan.json");
const plan = new Map(
  existsSync(planPath)
    ? JSON.parse(readFileSync(planPath, "utf8")).map((item) => [item.id, item])
    : []
);

// Reasons a still cannot be captured by this script.
const MANUAL = new Set([
  "AG-S07-01", // handles only appear on hover over a gallery row
  "AG-S19-01", "AG-S19-02", "AG-S19-03" // PDF page renders, not window captures
]);

const argv = process.argv.slice(2);
const value = (name, fallback) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : fallback;
};
const lang = value("--lang", process.env.AG_LANG ?? DEFAULT_LANG);
const theme = value("--theme", process.env.AG_THEME ?? DEFAULT_THEME);
assertVariant(lang, theme);
const only = value("--only", null);
const force = argv.includes("--force");

// The notes in the demo vault are Chinese. Capturing an English cell from a
// Chinese note would put the same pixels under a path that promises otherwise,
// so the figure has to name its English counterpart first.
const missingNotes = contentLangGaps(lang);
if (missingNotes.length) {
  console.error(`拒绝拍摄 ${lang}：${missingNotes.length} 条内容镜头缺少 noteEn（${missingNotes.slice(0, 3).join(", ")}…）`);
  console.error("先在 figures.json 里补上英文笔记路径，再跑 --lang en。");
  process.exit(2);
}

const queue = figures.filter((figure) => figure.media === "still"
  && !figure.kind
  && !MANUAL.has(figure.id)
  && (!only || figure.id === only));

const applied = await setTheme(theme);
console.log(`变体：${lang}/${theme}（背景 ${applied.bg}），队列 ${queue.length} 条`);

const results = [];
for (const figure of queue) {
  const note = lang === DEFAULT_LANG ? figure.note : figure.noteEn;
  const out = path.join(vault, stillRel(figure.id, lang, theme));
  if (existsSync(out) && !force) {
    results.push({ id: figure.id, skipped: "exists" });
    continue;
  }
  const from = lang === DEFAULT_LANG ? figure.from : (figure.fromEn ?? figure.from);
  const measurement = plan.get(figure.id);
  const extent = measurement?.extentCss;
  if (!extent) {
    results.push({ id: figure.id, error: `no measurement (${measurement?.mode ?? "not in plan"})` });
    continue;
  }
  try {
    // 100s: the in-page deadline is 75s, plus process start-up. Without this a
    // hung shot would block the batch until the whole shell is killed.
    const run = spawnSync("bash", [
      path.join(here, "shoot.sh"),
      figure.id,
      note,
      "preview",
      "final",
      from ?? "",
      String(extent),
      String(extent),
      from ? "0" : String(measurement?.start ?? 0)
    ], { encoding: "utf8", timeout: 100000, env: { ...process.env, AG_LANG: lang, AG_THEME: theme } });
    if (run.error) throw run.error;
    if (run.status !== 0) throw new Error(String(run.stderr || "shoot.sh failed").slice(0, 160));
    const line = ((run.stdout ?? "") + (run.stderr ?? "")).trim().split("\n").pop() ?? "";
    results.push({ id: figure.id, ok: line.includes('"chunks"'), line: line.slice(0, 120) });
  } catch (error) {
    results.push({ id: figure.id, error: String(error.message).slice(0, 160) });
  }
}

const ok = results.filter((item) => item.ok).length;
const failed = results.filter((item) => item.error);
console.log(`拍摄 ${ok}/${queue.length}，跳过 ${results.filter((item) => item.skipped).length}，失败 ${failed.length}`);
for (const item of failed) console.log(`  ✗ ${item.id}: ${item.error}`);
console.log("下一步：node tools/capture/finish-stills.mjs");
