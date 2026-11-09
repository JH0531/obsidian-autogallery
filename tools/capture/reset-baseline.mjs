#!/usr/bin/env node
// Restore the demo vault's plugin baseline, or check it without writing.
//
//   node tools/capture/reset-baseline.mjs --check     # diff only, exit 1 on drift
//   node tools/capture/reset-baseline.mjs            # write + structural assert
//   node tools/capture/reset-baseline.mjs --cli      # ...and reload the plugin
//
// The baseline lives in tools/capture/baseline.json so this script and preset.mjs
// share one source of truth. Structural assertions catch the cases the plugin
// would otherwise swallow silently: normalizeProfileRules drops invalid rules
// instead of reporting them, and normalizeSettings overwrites maxImagesPerRow
// with galleryMaxPerRow.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveVault } from "./lib/vault.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = resolveVault();
const dataPath = path.join(vault, ".obsidian", "plugins", "obsidian-autogallery", "data.json");
const baselinePath = path.join(here, "baseline.json");
const cli = process.env.OBSIDIAN_CLI ?? "C:/Program Files/Obsidian/Obsidian.com";
const vaultName = path.basename(vault);

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const reload = args.has("--cli");

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const current = existsSync(dataPath) ? JSON.parse(readFileSync(dataPath, "utf8")) : {};

const problems = [];
const expectedKeys = Object.keys(baseline);

for (const key of expectedKeys) {
  if (!(key in current)) problems.push(`missing key: ${key}`);
  else if (JSON.stringify(current[key]) !== JSON.stringify(baseline[key])) {
    problems.push(`drift: ${key}\n  baseline ${JSON.stringify(baseline[key])}\n  current  ${JSON.stringify(current[key])}`);
  }
}
for (const key of Object.keys(current)) {
  if (!(key in baseline)) problems.push(`unexpected key: ${key}`);
}

// Structural assertions: what the plugin will actually load.
const profiles = Array.isArray(current.profiles) ? current.profiles : [];
const ids = profiles.map((profile) => profile.id);
if (!ids.includes("auto")) problems.push("profiles 缺少内置 auto");
const wide = profiles.find((profile) => profile.id === "wide");
if (!wide) problems.push("profiles 缺少 wide");
else if (!Array.isArray(wide.rules) || wide.rules.length !== 3) {
  problems.push(`wide 规则数应为 3，实际 ${Array.isArray(wide.rules) ? wide.rules.length : wide.rules}`);
}
for (const profile of profiles) {
  if (!Array.isArray(profile.rules)) continue;
  for (const rule of profile.rules) {
    const range = String(rule.ratioRange ?? "");
    if (!/^[[(]\s*[\d.]+\s*,\s*[\d.]+\s*[\])]$/.test(range)) {
      problems.push(`${profile.id}: 非法 ratioRange ${range}`);
    }
  }
}
if (Number(current.maxImagesPerRow) !== Number(current.galleryMaxPerRow)) {
  problems.push("maxImagesPerRow 必须与 galleryMaxPerRow 相等（插件会用后者覆盖前者）");
}
if (!Array.isArray(current.routes) || !current.routes.some((route) => route.key === "album" && route.value === "trip")) {
  problems.push("routes 缺少 album/trip 路由");
}
if (current.language !== "zh") problems.push(`language 应为 zh，实际 ${current.language}`);

if (problems.length) {
  console.error(`基线不一致（${problems.length} 项）：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  if (checkOnly) process.exit(1);
  console.error("已中止写入；确认差异来自预期改动时，用 --force 覆盖基线。");
  if (!args.has("--force")) process.exit(1);
}

if (checkOnly) {
  console.log(`基线一致：${expectedKeys.length} 键，profiles=${ids.join("/")}， routes=${current.routes.length}`);
  process.exit(0);
}

writeFileSync(dataPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
console.log(`已写入 ${path.relative(vault, dataPath)}（${expectedKeys.length} 键）`);

if (reload) {
  const r = spawnSync(cli, [`vault=${vaultName}`, "plugin:reload", "id=obsidian-autogallery"], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error("plugin:reload 失败：", r.stderr || r.stdout);
    process.exit(1);
  }
  const assert = "JSON.stringify({keys:Object.keys(app.plugins.plugins['obsidian-autogallery'].settings).length,profiles:app.plugins.plugins['obsidian-autogallery'].settings.profiles.map(p=>p.id)})";
  const a = spawnSync(cli, [`vault=${vaultName}`, "eval", `code=${assert}`], { encoding: "utf8" });
  console.log(a.stdout.trim() || a.stderr.trim());
}
