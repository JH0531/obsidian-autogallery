import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(p, "utf8"));
const write = (p, value) => writeFileSync(p, `${JSON.stringify(value, null, 2)}\n`);

const semver = /^(\d+)\.(\d+)\.(\d+)$/;
const tags = execFileSync("git", ["tag", "--list"], { cwd: root, encoding: "utf8" })
  .split(/\r?\n/)
  .map((tag) => tag.trim())
  .filter((tag) => semver.test(tag))
  .sort((a, b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
  });

const latest = tags.at(-1);
let version;
if (!latest) {
  version = "1.0.0";
} else {
  const [major, minor, patch] = latest.split(".").map(Number);
  version = patch >= 9 ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
}

if (process.argv.includes("--print")) {
  console.log(version);
  process.exit(0);
}

const manifestPath = join(root, "manifest.json");
const manifest = read(manifestPath);
manifest.version = version;
write(manifestPath, manifest);

const packagePath = join(root, "package.json");
const pkg = read(packagePath);
pkg.version = version;
write(packagePath, pkg);

const lockPath = join(root, "package-lock.json");
if (existsSync(lockPath)) {
  const lock = read(lockPath);
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  write(lockPath, lock);
}

for (const vault of ["demo", "demo-en"]) {
  const manifestVault = join(root, vault, ".obsidian", "plugins", "obsidian-autogallery", "manifest.json");
  if (existsSync(manifestVault)) {
    const value = read(manifestVault);
    value.version = version;
    write(manifestVault, value);
  }
  const buildPath = join(root, vault, "BUILD.json");
  if (existsSync(buildPath)) {
    const build = read(buildPath);
    build.pluginVersion = version;
    write(buildPath, build);
  }
}

const versionsPath = join(root, "versions.json");
const versions = existsSync(versionsPath) ? read(versionsPath) : {};
versions[version] = manifest.minAppVersion;
write(versionsPath, versions);

console.log(version);
