#!/usr/bin/env node
// Encode captured frames into an H.264 MP4 for GitHub inline playback.
//
//   node tools/capture/encode-mp4.mjs <id> [--fps 24] [--crf 23]
//
// Output: media/<lang>/<theme>/motion/<id>.mp4 (AG_LANG / AG_THEME, default
// zh / dark) — 1200×800, yuv420p, no audio, +faststart, ≤ 12 s, ≤ 4 MB. The
// file is uploaded to a PR comment later; GitHub only renders it inline when
// the resulting user-attachments URL sits alone in its own paragraph.

import { readFileSync, existsSync, statSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveVault } from "./lib/vault.mjs";
import { motionRel, DEFAULT_LANG, DEFAULT_THEME } from "./lib/media.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = resolveVault();
const lang = process.env.AG_LANG ?? DEFAULT_LANG;
const theme = process.env.AG_THEME ?? DEFAULT_THEME;
const id = process.argv[2];
if (!id) { console.error("用法：node tools/capture/encode-mp4.mjs <id>"); process.exit(1); }
const argValue = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index > 0 ? Number(process.argv[index + 1]) : fallback;
};

const framesDir = path.join(vault, ".cache", "frames", id);
if (!existsSync(framesDir)) { console.error(`缺少帧目录 ${framesDir}`); process.exit(1); }
const metaPath = path.join(framesDir, "meta.json");
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, "utf8")) : {};
const inputFps = meta.fps ?? 10;
const fps = argValue("--fps", 24);
const crf = argValue("--crf", 23);
const out = path.join(vault, motionRel(id, lang, theme, "mp4"));

// Re-time: the capture ran at `inputFps`, the delivery at `fps`. `-vf fps=`
// resamples instead of dropping frames, which keeps short interactions smooth.
execFileSync("ffmpeg", [
  "-y", "-hide_banner", "-loglevel", "error",
  "-framerate", String(inputFps),
  "-i", path.join(framesDir, "f%04d.png"),
  "-vf", `fps=${fps},scale=1200:-2:flags=lanczos`,
  "-c:v", "libx264", "-crf", String(crf), "-pix_fmt", "yuv420p",
  "-movflags", "+faststart", "-an", out
]);

const bytes = statSync(out).size;
const probe = JSON.parse(execFileSync("ffprobe", [
  "-v", "error", "-show_streams", "-show_format", "-of", "json", out
], { encoding: "utf8" }));
const stream = probe.streams?.[0] ?? {};
const seconds = Number(probe.format?.duration ?? 0);
console.log(`${id}: ${Math.round(bytes / 1024)}KB, ${seconds.toFixed(1)}s, ${stream.width}×${stream.height}, ${stream.pix_fmt}`);
if (bytes > 4 * 1024 * 1024) console.warn("超过 4MB：提高 --crf 或缩短时长");
if (seconds > 12) console.warn("超过 12s：剪短交互过程");
