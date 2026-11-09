#!/usr/bin/env node
// Re-capture every interface still in one cell of the language × theme matrix.
//
//   node tools/capture/winapp/run-ui.mjs zh
//   node tools/capture/winapp/run-ui.mjs zh --theme light
//   node tools/capture/winapp/run-ui.mjs en --theme light
//
// Interface text is part of the picture, so each of these exists four times.
// The language lives in localStorage and needs a reload, which also throws away
// the calibration — every scene starts with prepare() and re-measures. The theme
// is switched in place and survives that reload.
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
import { setLanguage, pageEval } from "./lib/scene.mjs";
import { setTheme } from "../lib/theme.mjs";
import { assertVariant, DEFAULT_THEME } from "../lib/media.mjs";

const lang = process.argv[2] === "en" ? "en" : "zh";
const themeAt = process.argv.indexOf("--theme");
const theme = themeAt > 0 ? process.argv[themeAt + 1] : DEFAULT_THEME;
assertVariant(lang, theme);

const SCENES = [
  "AG-S12-04", "AG-A13-01",
  "AG-S14-01", "AG-S15-01",
  "AG-S18-01", "AG-V18-01",
  "AG-S20-01", "AG-S20-02", "AG-S20-03", "AG-A20-01",
  "AG-S22-01", "AG-S22-02"
];

await setLanguage(lang);
// The plugin carries its own language setting; it does not simply mirror
// Obsidian's, and it was pinned to zh here. Set it explicitly.
const applied = await pageEval(`
  const plugin = app.plugins.plugins["obsidian-autogallery"];
  const before = plugin.settings.language;
  plugin.settings.language = ${JSON.stringify(lang)};
  await plugin.saveSettings();
  return { before, after: plugin.settings.language };
`).catch((e) => ({ error: String(e.message).slice(0, 80) }));
const themed = await setTheme(theme);
console.log(`变体：${lang}/${theme}（背景 ${themed.bg}）`, JSON.stringify(applied));

for (const id of SCENES) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [join(HERE, "scenes", `${id}.mjs`)], {
    env: { ...process.env, AG_LANG: lang, AG_THEME: theme },
    encoding: "utf8",
    windowsHide: true
  });
  const ms = Date.now() - started;
  const ok = run.status === 0;
  const last = (run.stdout || "").trim().split("\n").slice(-1)[0].slice(0, 120);
  console.log(`${ok ? "OK  " : "FAIL"} ${id.padEnd(11)} ${String(ms).padStart(6)}ms ${ok ? "" : (run.stderr || "").split("\n").slice(0, 3).join(" | ")}`);
  if (ok && last) console.log(`      ${last}`);
}
