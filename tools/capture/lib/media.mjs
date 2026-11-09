// Where a captured asset lives, and how a variant is named.
//
// One rule for the whole tree: media/<lang>/<theme>/<kind>/<id>.<ext>. The
// language and the theme are carried by the directory and never by the file
// name, so one figure id is the same string in all four cells and the site
// resolves a variant by path alone.
//
// LANGS / THEMES are read from figures.json: the figure list declares the
// matrix, this module is the only place that turns it into a path. Five scripts
// need that path; keeping the template in one of them and copying it into the
// other four is how `media/stills/<id>.png` outlived the switch to WebP.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIGURES = JSON.parse(readFileSync(join(HERE, "..", "figures.json"), "utf8"));

export const LANGS = FIGURES.matrix?.lang ?? ["zh", "en"];
export const THEMES = FIGURES.matrix?.theme ?? ["dark", "light"];
export const DEFAULT_LANG = LANGS[0];
export const DEFAULT_THEME = THEMES[0];

// A theme-independent asset: the frame is identical in both themes, so it is
// stored once. PDF page renders and the split poster live here. The directory is
// still `media/<lang>/<theme>/`, with `any` in the theme slot, so one path
// template covers everything.
export const THEME_ANY = "any";

// Stills are delivered as WebP: a flat UI screenshot lands at ~20% of the PNG
// bytes and a photo frame at ~60% of the JPEG bytes, at q85.
export const STILL_EXT = "webp";

// Posters are APNG: GitHub transcodes an animated WebP and drops the animation.
export const POSTER_EXT = "apng";

export function assertVariant(lang, theme) {
  if (!LANGS.includes(lang)) throw new Error(`未知语言 ${lang}（可用：${LANGS.join(", ")}）`);
  if (theme !== THEME_ANY && !THEMES.includes(theme)) {
    throw new Error(`未知主题 ${theme}（可用：${THEMES.join(", ")}, ${THEME_ANY}）`);
  }
  return { lang, theme };
}

// The cells a figure actually has. A theme-independent figure has one cell per
// language; everything else has one per language and theme.
export function variants(entry = null) {
  const themes = entry?.theme === THEME_ANY ? [THEME_ANY] : THEMES;
  return LANGS.flatMap((lang) => themes.map((theme) => ({ lang, theme })));
}

export function variantKey(id, lang, theme) {
  return `${id}/${lang}/${theme}`;
}

export function figure(id) {
  return FIGURES.items.find((item) => item.id === id) ?? null;
}

// A content frame shows the note itself, so its English cell needs an English
// note; an interface frame takes its text from the app locale instead.
function needsEnglishNote(entry) {
  return Boolean(entry) && entry.kind !== "ui" && !entry.noteEn;
}

export function contentLangGaps(lang) {
  if (lang === DEFAULT_LANG) return [];
  return FIGURES.items.filter(needsEnglishNote).map((item) => item.id);
}

// Last-mile guard: refuses to write a Chinese frame under media/en/ even when
// the caller forgot to check. The path promises a language; the pixels must
// keep that promise.
export function assertContentLang(id, lang) {
  if (lang === DEFAULT_LANG) return;
  if (needsEnglishNote(figure(id))) {
    throw new Error(`${id}: ${lang} 版本需要 figures.json 的 noteEn（英文笔记）`);
  }
}

export function stillRel(id, lang, theme) {
  assertVariant(lang, theme);
  return `media/${lang}/${theme}/stills/${id}.${STILL_EXT}`;
}

export function motionRel(id, lang, theme, ext) {
  assertVariant(lang, theme);
  return `media/${lang}/${theme}/motion/${id}.${ext}`;
}

export function posterRel(id, lang) {
  assertVariant(lang, THEME_ANY);
  return `media/${lang}/${THEME_ANY}/posters/${id}.${POSTER_EXT}`;
}

// A poster is the still frame of a clip: AG-V00-01 → AG-P00-01.
export function posterId(id) {
  return id.replace(/^AG-([SAV])/, "AG-P");
}

// WebP dimensions without a decoder: the RIFF container says which of the three
// bitstreams is inside, and each one stores the canvas size differently.
export function webpSize(file) {
  let buffer;
  try {
    buffer = readFileSync(file);
  } catch {
    return null;
  }
  if (buffer.length < 30) return null;
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") return null;
  const chunk = buffer.toString("ascii", 12, 16);

  if (chunk === "VP8 ") {
    // Lossy: 3-byte frame tag, the 9d 01 2a start code, then 14-bit dimensions.
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  if (chunk === "VP8L") {
    // Lossless: signature byte, then two 14-bit values minus one.
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === "VP8X") {
    // Extended (alpha or animation): 24-bit canvas size minus one.
    return { width: buffer.readUIntLE(24, 3) + 1, height: buffer.readUIntLE(27, 3) + 1 };
  }
  return null;
}

// A frame that is not a WebP is not a still, no matter what the extension says.
export function isWebp(file) {
  try {
    const head = readFileSync(file).subarray(0, 12);
    return head.toString("ascii", 0, 4) === "RIFF" && head.toString("ascii", 8, 12) === "WEBP";
  } catch {
    return false;
  }
}
