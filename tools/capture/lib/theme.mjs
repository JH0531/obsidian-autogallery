// Switch the app theme before a capture.
//
// The snippet in tools/capture/theme.js is an async function body; it is
// evaluated in the note window through the shared CDP client, which prefers the
// `app://obsidian.md` target over the settings window's `about:blank`.
//
//   import { setTheme } from "./lib/theme.mjs";
//   await setTheme("light");

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pageEval } from "../winapp/cdp.mjs";
import { assertVariant, DEFAULT_LANG, DEFAULT_THEME } from "./media.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BODY = readFileSync(join(HERE, "..", "theme.js"), "utf8");

export async function setTheme(theme = DEFAULT_THEME) {
  assertVariant(DEFAULT_LANG, theme);
  const result = await pageEval(`const __theme = ${JSON.stringify(theme)};\n${BODY}`, { timeoutMs: 20000 });
  if (!result?.ok) throw new Error(`切换主题到 ${theme} 失败：${result?.reason ?? "未知原因"}`);
  return result;
}
