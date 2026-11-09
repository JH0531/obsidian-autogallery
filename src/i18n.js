import zh from "./locales/zh.js";
import common from "./locales/en-common.js";
import settings from "./locales/en-settings.js";
import pdf from "./locales/en-pdf.js";
import crop from "./locales/en-crop.js";
import editor from "./locales/en-editor.js";
import profile from "./locales/en-profile.js";
import print from "./locales/en-print.js";
import confirm from "./locales/en-confirm.js";

/**
 * Supported UI languages (the languages `t()` can actually render).
 * The data-layer (defaults.js / normalizeSettings) whitelists
 * `settings.language` against this list plus FOLLOW.
 */
export const LANGS = ["zh", "en"];

/**
 * Pseudo-language: mirror whatever Obsidian itself is using. It resolves to a
 * real LANGS entry at runtime; if Obsidian's language is neither zh nor en it
 * falls back to English. It is the default so a fresh install matches the host
 * app's locale instead of always booting in Chinese.
 */
export const FOLLOW = "follow";

// Single merged English dictionary. Key scheme: the Chinese source string is
// the key; `en-*.js` maps it to English. A few ASCII keys (e.g.
// "settings.language") are special and also exist in zh.js so the Chinese form
// can differ from the raw key.
const en = {
  ...common,
  ...settings,
  ...pdf,
  ...crop,
  ...editor,
  ...profile,
  ...print,
  ...confirm
};

let currentLang = "zh";
// Supplies Obsidian's active language code, e.g. () => getLanguage().
let obsidianLangGetter = null;

function resolveObsidianLang() {
  if (typeof obsidianLangGetter !== "function") return "en";
  const ol = obsidianLangGetter();
  if (typeof ol === "string") {
    const lower = ol.toLowerCase();
    if (lower.startsWith("zh")) return "zh";
    if (LANGS.includes(lower)) return lower;
  }
  return "en";
}

function resolveLang(lang) {
  if (lang === FOLLOW) return resolveObsidianLang();
  return LANGS.includes(lang) ? lang : "en";
}

export function initI18n(lang, obsidianLangGetter_) {
  if (typeof obsidianLangGetter_ === "function") obsidianLangGetter = obsidianLangGetter_;
  currentLang = resolveLang(lang);
}

export function setLang(lang) {
  currentLang = resolveLang(lang);
}

export function getLang() {
  return currentLang;
}

/**
 * Translate `key`.
 * - en mode: en[key] ?? key
 * - zh mode: zh[key] ?? key  (when the key is itself the Chinese text, zh has no
 *   entry and the key is returned unchanged)
 * Supports `{var}` placeholders via the `vars` object.
 */
export function t(key, vars) {
  const dict = currentLang === "en" ? en : zh;
  let str = key in dict ? dict[key] : key;
  if (vars && typeof str === "string") {
    for (const k in vars) {
      str = str.split("{" + k + "}").join(String(vars[k]));
    }
  }
  return str;
}
