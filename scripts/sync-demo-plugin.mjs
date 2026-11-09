import { createHash } from "node:crypto";
import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
const mainPath = join(root, "main.js");
const mainSha256 = createHash("sha256").update(readFileSync(mainPath)).digest("hex");
const pluginCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const builtAt = new Date().toISOString();

for (const vault of ["demo", "demo-en"]) {
  const dir = join(root, vault, ".obsidian", "plugins", "obsidian-autogallery");
  copyFileSync(mainPath, join(dir, "main.js"));
  copyFileSync(join(root, "manifest.json"), join(dir, "manifest.json"));
  writeFileSync(
    join(root, vault, "BUILD.json"),
    `${JSON.stringify({ pluginVersion: manifest.version, pluginCommit, mainSha256, builtAt }, null, 2)}\n`
  );
  console.log(`synced ${vault}: ${manifest.version} ${mainSha256.slice(0, 8)}`);
}
