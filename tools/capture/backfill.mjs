#!/usr/bin/env node
// Copy the published media into the plugin repository and verify the README.
//
//   node tools/capture/backfill.mjs            # dry run
//   node tools/capture/backfill.mjs --write    # copy + prune assets/demo
//
// Only items with `readme` set and `status: "published"` are copied. Files in
// assets/demo that no README line references are removed, so the repository
// never accumulates unused media again.

import { readFileSync, copyFileSync, readdirSync, existsSync, unlinkSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveVault } from "./lib/vault.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = resolveVault();
const repo = process.env.AG_REPO ?? "F:/Originality Space/Codes/obsidian_autogallery";
const assets = path.join(repo, "assets", "demo");
const write = process.argv.includes("--write");

const manifest = JSON.parse(readFileSync(path.join(vault, "media", "manifest.json"), "utf8"));
const wanted = manifest.items.filter((item) => item.readme && item.status === "published" && item.file);

const readmes = ["README.md", "README-EN.md"].map((name) => ({
  name,
  text: readFileSync(path.join(repo, name), "utf8")
}));

const referenced = new Set();
for (const { text } of readmes) {
  for (const match of text.matchAll(/assets\/demo\/([^)\s"']+)/g)) referenced.add(match[1]);
}

const plan = [];
for (const item of wanted) {
  const from = path.join(vault, item.file);
  const base = path.basename(item.file);
  if (!existsSync(from)) { plan.push({ id: item.id, error: "源文件缺失" }); continue; }
  plan.push({ id: item.id, copy: base, referenced: referenced.has(base) });
}

const orphans = existsSync(assets)
  ? readdirSync(assets).filter((name) => !referenced.has(name))
  : [];

for (const item of plan) {
  if (item.error) console.log(`✗ ${item.id}: ${item.error}`);
  else if (!item.referenced) console.log(`! ${item.id}: 已标记发布但 README 未引用 ${item.copy}`);
}
for (const name of orphans) console.log(`! assets/demo/${name} 未被 README 引用`);

if (!write) {
  console.log(`\n预演：${plan.filter((item) => item.copy).length} 个文件待复制，${orphans.length} 个待清理。加 --write 执行。`);
  process.exit(0);
}

mkdirSync(assets, { recursive: true });
for (const item of plan) {
  if (!item.copy) continue;
  copyFileSync(path.join(vault, item.file), path.join(assets, item.copy));
}
for (const name of orphans) unlinkSync(path.join(assets, name));
console.log(`已复制 ${plan.filter((item) => item.copy).length} 个文件，清理 ${orphans.length} 个未引用文件`);
