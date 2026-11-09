// Where the demo vault lives.
//
// The capture toolchain ships with the plugin repository, but its outputs —
// stills, videos, manifests, the plugin baseline — belong to a vault. Keeping
// the two apart means the tools are versioned while the vault stays a working
// directory the author can point anywhere.
//
// Resolution order:
//   1. AG_VAULT environment variable
//   2. tools/capture/vault.local.json   (gitignored, machine specific)
// Nothing else: a silent fallback to a guessed path is how captures end up
// writing into the wrong vault.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CAPTURE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = join(CAPTURE_DIR, "vault.local.json");

export function resolveVault() {
  const fromEnv = process.env.AG_VAULT;
  if (fromEnv) return normalize(fromEnv);

  if (existsSync(CONFIG)) {
    const raw = readFileSync(CONFIG, "utf8").trim();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.vault) return normalize(parsed.vault);
      } catch {
        return normalize(raw);
      }
    }
  }

  throw new Error(`未配置演示库：设置 AG_VAULT，或写入 ${CONFIG}（格式见 vault.example.json）`);
}

// A path pasted from Explorer or a JSON string can carry doubled separators;
// fs tolerates them on Windows but they leak into logs and into `path.basename`.
function normalize(value) {
  return value.replace(/[\\/]+/g, "\\");
}
