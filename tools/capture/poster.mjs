#!/usr/bin/env node
// Extract a poster frame for every motion item.
//
//   AG_LANG=zh AG_THEME=dark node tools/capture/poster.mjs <id>
//
// The poster lives beside the clip it belongs to: media/<lang>/<theme>/posters/
// <P-id>.webp. MP4 → 0.6 s in, which avoids the empty state before a gesture
// starts; an APNG (legacy) → its first frame.

import { existsSync, statSync, mkdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveVault } from "./lib/vault.mjs";
import { motionRel, posterRel, posterId as toPosterId, DEFAULT_LANG, DEFAULT_THEME } from "./lib/media.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = resolveVault();
const lang = process.env.AG_LANG ?? DEFAULT_LANG;
const theme = process.env.AG_THEME ?? DEFAULT_THEME;
const id = process.argv[2];
if (!id) { console.error("用法：node tools/capture/poster.mjs <id>"); process.exit(1); }

const posterId = toPosterId(id);
const out = path.join(vault, posterRel(posterId, lang, theme));
const apng = path.join(vault, motionRel(id, lang, theme, "png"));
const mp4 = path.join(vault, motionRel(id, lang, theme, "mp4"));
mkdirSync(path.dirname(out), { recursive: true });

// The frame is grabbed as PNG and converted, so the delivery file is always the
// same WebP the stills use.
const png = `${out}.tmp.png`;
if (existsSync(apng)) {
  // ImageMagick 7 dropped `-frames`; ffmpeg reads APNG directly and is already
  // a hard dependency of the encoding step.
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-i", apng, "-frames:v", "1", png]);
} else if (existsSync(mp4)) {
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", "0.6", "-i", mp4, "-frames:v", "1", png]);
} else {
  console.error(`没有可用的动效文件：${id}`);
  process.exit(1);
}

execFileSync("magick", [png, "-strip", "-quality", "85", "-define", "webp:method=6", out]);
unlinkSync(png);
for (const stale of ["png", "jpg"]) {
  const sibling = out.replace(/\.webp$/, `.${stale}`);
  if (existsSync(sibling)) unlinkSync(sibling);
}
console.log(`${posterId} [${lang}/${theme}]: ${Math.round(statSync(out).size / 1024)}KB`);
