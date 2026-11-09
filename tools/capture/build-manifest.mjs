#!/usr/bin/env node
// Rebuild media/manifest.json from the figure list (tools/capture/figures.json) and the
// files on disk. Figure specs describe intent; this script fills in what was
// actually produced (path, bytes, pixel size, status, owning page).
//
//   node tools/capture/build-manifest.mjs
//
// Every figure expands into one item per cell of the language × theme matrix:
// media/<lang>/<theme>/<kind>/<id>.<ext>. The four cells are recorded
// separately, so "stills are done" can no longer mean "the dark Chinese ones
// are done" — which is exactly how the previous manifest overstated progress.

import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { resolveVault } from "./lib/vault.mjs";
import {
  LANGS, THEMES, THEME_ANY, STILL_EXT, POSTER_EXT, variants, variantKey,
  stillRel, motionRel, posterRel, posterId, webpSize
} from "./lib/media.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const vault = resolveVault();
const figureSet = JSON.parse(readFileSync(path.join(here, "figures.json"), "utf8"));
const figures = figureSet.items;
const manifestPath = path.join(vault, "media", "manifest.json");
const pluginDir = path.join(vault, ".obsidian", "plugins", "obsidian-autogallery");
const pluginManifest = JSON.parse(readFileSync(path.join(pluginDir, "manifest.json"), "utf8"));

// v2 keyed items by id alone, which collapsed four variants into one row. Those
// rows carry no lang/theme, so they cannot be carried over; the files are
// re-discovered below anyway and only the human-reviewed states would be lost.
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { items: [] };
const previousByKey = new Map(
  (previous.version === 3 ? previous.items : []).map((item) => [variantKey(item.id, item.lang, item.theme), item])
);

const STAGE = { width: 1200, height: 800, dpr: 1.25, fontSize: 16 };

function pluginCommit() {
  try {
    return execFileSync("git", ["-C", "F:/Originality Space/Codes/obsidian_autogallery", "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function probeSize(file) {
  try {
    const out = execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0", file
    ], { encoding: "utf8" }).trim();
    const [width, height] = out.split(",").map(Number);
    return width > 0 && height > 0 ? { width, height } : null;
  } catch {
    return null;
  }
}

function resolveFile(figure, lang, theme) {
  if (figure.media === "still") return { file: stillRel(figure.id, lang, theme), kind: "webp" };
  if (figure.media === "apng") return { file: motionRel(figure.id, lang, theme, "png"), kind: "other" };
  return { file: motionRel(figure.id, lang, theme, "mp4"), kind: "other" };
}

const items = [];
for (const figure of figures) {
  for (const { lang, theme } of variants(figure)) {
    const target = resolveFile(figure, lang, theme);
    const abs = path.join(vault, target.file);
    const exists = existsSync(abs);
    const size = exists
      ? (target.kind === "webp" ? webpSize(abs) : probeSize(abs))
      : null;
    const key = variantKey(figure.id, lang, theme);
    const prev = previousByKey.get(key) ?? {};

    // Motion items record their real duration so the ≤6 s / ≤12 s budget is
    // checkable without re-probing every file by hand.
    let durationMs = prev.durationMs;
    if (exists && figure.media !== "still") {
      try {
        const probe = JSON.parse(execFileSync("ffprobe", [
          "-v", "error", "-show_format", "-show_streams", "-of", "json", abs
        ], { encoding: "utf8" }));
        durationMs = Math.round(Number(probe.format?.duration ?? 0) * 1000) || durationMs;
      } catch { /* keep the previous value */ }
      // ffmpeg reports no duration for APNG; the capture log has the real span.
      if (!durationMs) {
        try {
          const meta = JSON.parse(readFileSync(path.join(vault, ".cache", "frames", figure.id, "meta.json"), "utf8"));
          const stamps = meta.stamps ?? [];
          if (stamps.length > 1) durationMs = stamps[stamps.length - 1];
        } catch { /* no capture log on this machine */ }
      }
    }

    // Posters are theme-independent: one file per language, composited from both themes.
    const poster = figure.media === "still" ? null : posterRel(posterId(figure.id), lang);
    items.push({
      id: figure.id,
      lang,
      theme,
      media: figure.media,
      note: figure.note,
      page: figure.page,
      from: figure.from ?? null,
      file: exists ? target.file : null,
      poster: poster && existsSync(path.join(vault, poster)) ? poster : null,
      width: size?.width ?? null,
      height: size?.height ?? null,
      bytes: exists ? statSync(abs).size : null,
      ...(durationMs ? { durationMs } : {}),
      ...(prev.fps ? { fps: prev.fps } : {}),
      ...(prev.frames ? { frames: prev.frames } : {}),
      firstFrame: figure.media === "still" ? null : (prev.firstFrame ?? "complete"),
      // Status is derived from the file, never inherited: a deleted or renamed
      // asset used to keep its old "encoded" state, so the manifest claimed a
      // take existed with `file: null`. Only the two human-reviewed states are
      // allowed to survive, and only while the file is still there.
      status: exists
        ? (prev.status === "verified" || prev.status === "published" ? prev.status : "encoded")
        : "planned",
      legacy: prev.legacy ?? [],
      readme: null
    });
  }
}

items.sort((a, b) => String(a.page).localeCompare(String(b.page))
  || a.id.localeCompare(b.id)
  || LANGS.indexOf(a.lang) - LANGS.indexOf(b.lang)
  || [THEMES[0], THEMES[1], THEME_ANY].indexOf(a.theme) - [THEMES[0], THEMES[1], THEME_ANY].indexOf(b.theme));

const manifest = {
  version: 3,
  pluginVersion: pluginManifest.version,
  pluginCommit: pluginCommit(),
  stage: STAGE,
  matrix: { lang: LANGS, theme: THEMES },
  still: { format: STILL_EXT, quality: 85 },
  poster: { format: POSTER_EXT, width: 1000, height: 600, fps: 10, colors: 256, dpi: 72 },
  generatedAt: new Date().toISOString().slice(0, 10),
  items
};

writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
const counts = items.reduce((acc, item) => (acc[item.status] = (acc[item.status] ?? 0) + 1, acc), {});
const cells = LANGS.flatMap((lang) => [...THEMES, THEME_ANY].map((theme) => {
  const rows = items.filter((item) => item.lang === lang && item.theme === theme);
  if (!rows.length) return null;
  return `${lang}/${theme} ${rows.filter((r) => r.status !== "planned").length}/${rows.length}`;
})).filter(Boolean).join(" · ");
console.log(`manifest: ${items.length} 条目 ${JSON.stringify(counts)}`);
console.log(`  分格：${cells}`);
console.log(`  → ${path.relative(vault, manifestPath)}`);
