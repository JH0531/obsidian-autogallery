#!/usr/bin/env node
// Apply a temporary recording preset on top of the frozen baseline.
//
//   node tools/capture/preset.mjs en          # English UI shots
//   node tools/capture/preset.mjs zh          # back to Chinese
//   node tools/capture/preset.mjs pdf-split   # heading breaks on (h2)
//   node tools/capture/preset.mjs orphan-0    # disable the orphan rule
//   node tools/capture/preset.mjs baseline    # restore tools/capture/baseline.json
//
// Presets only touch the whitelisted keys below; everything else stays at the
// baseline. Recording with a preset must be followed by `preset.mjs baseline`
// so the next batch starts from the same state.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveVault } from "./lib/vault.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = resolveVault();
const dataPath = path.join(vault, ".obsidian", "plugins", "obsidian-autogallery", "data.json");
const baseline = JSON.parse(readFileSync(path.join(here, "baseline.json"), "utf8"));

const PRESETS = {
  baseline: {},
  zh: { language: "zh" },
  en: { language: "en" },
  "pdf-split": {
    pdfPagination: { ...baseline.pdfPagination, headingBreakEnabled: true, headingBreakLevel: 2 }
  },
  "orphan-0": { galleryOrphanMaxHeight: 0 },
  "orphan-1200": { galleryOrphanMaxHeight: 1200 }
};

const name = process.argv[2] ?? "";
if (!(name in PRESETS)) {
  console.error(`未知预设：${name || "(空)"}\n可用：${Object.keys(PRESETS).join(", ")}`);
  process.exit(1);
}

const next = structuredClone(baseline);
for (const [key, value] of Object.entries(PRESETS[name])) next[key] = value;
writeFileSync(dataPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`预设 ${name} 已写入${name === "baseline" ? "（基线）" : ""}；录完请执行 node tools/capture/preset.mjs baseline`);
