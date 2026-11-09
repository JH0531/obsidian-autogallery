#!/usr/bin/env node
// 校验内置演示库与插件构建是否同步。
//
//   npm run check:demo
//
// 仓库里有两个平行演示库：demo/（中文）与 demo-en/（英文）。两者都随仓库
// 分发，里面各有一份插件副本。副本一旦落后于根目录的 main.js，用户下载到
// 的就是旧插件，因此在提交与打包前必须逐个比对：
//   1. 库内 main.js 与根 main.js 的 sha256 相同；
//   2. 两份 manifest.json 的版本一致；
//   3. 库内 BUILD.json 记录的就是这份构建；
//   4. 笔记与素材目录齐全；英文库不得残留中文正文。

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const rootManifest = read(path.join(root, "manifest.json"));
const rootMain = path.join(root, "main.js");
const problems = [];

const VAULTS = [
  { dir: "demo", label: "zh", minNotes: 20 },
  { dir: "demo-en", label: "en", minNotes: 20 }
];

for (const vault of VAULTS) {
  const base = path.join(root, vault.dir);
  const pluginDir = path.join(base, ".obsidian", "plugins", "obsidian-autogallery");
  const tag = `${vault.dir}/`;

  if (!existsSync(base)) {
    problems.push(`缺少目录 ${vault.dir}`);
    continue;
  }

  const vaultMain = path.join(pluginDir, "main.js");
  for (const file of [rootMain, vaultMain]) {
    if (!existsSync(file)) problems.push(`缺少 ${path.relative(root, file)}`);
  }
  if (existsSync(rootMain) && existsSync(vaultMain) && sha(rootMain) !== sha(vaultMain)) {
    problems.push(`${tag} 内的插件构建与根 main.js 不一致（${sha(rootMain).slice(0, 8)} ≠ ${sha(vaultMain).slice(0, 8)}）`);
  }

  const vaultManifestPath = path.join(pluginDir, "manifest.json");
  if (!existsSync(vaultManifestPath)) problems.push(`缺少 ${tag} 内的 manifest.json`);
  else if (read(vaultManifestPath).version !== rootManifest.version) {
    problems.push(`插件版本不一致：根 ${rootManifest.version} / ${tag} ${read(vaultManifestPath).version}`);
  }

  const buildPath = path.join(base, "BUILD.json");
  if (!existsSync(buildPath)) problems.push(`缺少 ${tag} BUILD.json`);
  else if (existsSync(vaultMain)) {
    const build = read(buildPath);
    if (build.pluginVersion !== rootManifest.version) problems.push(`${tag} BUILD.json 的 pluginVersion 已过期`);
    if (build.mainSha256 !== sha(vaultMain)) problems.push(`${tag} BUILD.json 的 mainSha256 已过期`);
  }

  const notes = existsSync(base) ? readdirSync(base).filter((name) => name.endsWith(".md")) : [];
  if (notes.length < vault.minNotes) problems.push(`${tag} 笔记不足：${notes.length} 篇（期望 ${vault.minNotes}）`);
  for (const dir of ["assets/photo", "assets/ratio", ".obsidian/snippets"]) {
    if (!existsSync(path.join(base, dir))) problems.push(`缺少目录 ${tag}${dir}`);
  }
  if (!existsSync(path.join(base, ".obsidian", "community-plugins.json"))) {
    problems.push(`缺少 ${tag} community-plugins.json，下载后插件不会自动启用`);
  }

  if (vault.label === "en") {
    const cjk = [];
    for (const note of notes) {
      const text = readFileSync(path.join(base, note), "utf8");
      if (/[\u4e00-\u9fff]/.test(text)) cjk.push(note);
    }
    if (cjk.length) problems.push(`${tag} 英文库残留中文正文：${cjk.join("、")}`);
  }
}

if (problems.length) {
  console.error("演示库校验失败：");
  for (const item of problems) console.error(`  - ${item}`);
  process.exit(1);
}

const summary = VAULTS.map((vault) => {
  const base = path.join(root, vault.dir);
  const notes = readdirSync(base).filter((name) => name.endsWith(".md")).length;
  return `${vault.dir} ${notes} 篇`;
}).join(" · ");
console.log(`demo ok：${summary}，插件 ${rootManifest.version}，构建 ${read(path.join(root, "demo", "BUILD.json")).pluginCommit.slice(0, 7)}`);
