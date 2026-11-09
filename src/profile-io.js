import { t } from "./i18n.js";
import { validateProfile } from "./profile-rules.js";

export function serializeProfileModule(profile) {
  if (Array.isArray(profile)) return `// AutoGallery external layout profiles\nexport const profiles = ${JSON.stringify(profile, null, 2)};\nexport default profiles;\n`;
  return `// AutoGallery external layout profile\nexport const profile = ${JSON.stringify(profile, null, 2)};\nexport default profile;\n`;
}

/**
 * Parse an exported profile module back into validated profiles.
 *
 * Accepted inputs:
 *   - files produced by serializeProfileModule, in either single-object or
 *     array form, with the `export default ...` trailer in any position
 *   - plain JSON objects / arrays (.json files)
 *   - `const profiles = ...` / `module.exports = ...` snippets
 *
 * The whole file is validated before anything is returned: a single invalid
 * entry rejects the entire import, so settings are never partially updated.
 */
export function parseProfileModule(source, { allowMissingId = false, fileName = "" } = {}) {
  let text = String(source ?? "").trim();
  // Leading line comments and block comments.
  text = text.replace(/^(?:\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/\s*)+/, "");
  // `export default {...}` exports the value directly.
  text = text.replace(/^\s*export\s+default\s+(?=[\[{])/, "");
  // `export default <identifier>;` statements, on their own line anywhere.
  text = text.replace(/^\s*export\s+default\s+[\w$]+\s*;?\s*$/gm, "");
  // Common assignment prefixes: `export const profiles =`, `const profile =`,
  // `module.exports =`, bare `profile =`.
  text = text.replace(/^\s*(?:export\s+)?(?:const\s+|let\s+|var\s+)?profiles?\s*=\s*/m, "");
  text = text.replace(/^\s*module\.exports\s*=\s*/m, "");
  text = text.trim().replace(/;\s*$/, "");
  const prefix = fileName ? `${fileName}：` : "";
  if (!/^[\[{]/.test(text)) throw new Error(`${prefix}${t("外挂配置必须导出 profile 对象或对象数组")}`);
  let value;
  try { value = Function(`"use strict"; return (${text});`)(); }
  catch { throw new Error(`${prefix}${t("外挂配置不是有效的 JavaScript 对象或数组")}`); }
  const list = Array.isArray(value) ? value : [value];
  if (!list.length) throw new Error(`${prefix}${t("外挂配置不包含任何模板")}`);
  const normalized = list.map((profile, index) => {
    try {
      return validateProfile(profile, { allowMissingId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`${prefix}${t("第 {n} 个模板无效：{message}", { n: index + 1, message })}`);
    }
  });
  return Array.isArray(value) ? normalized : normalized[0];
}
