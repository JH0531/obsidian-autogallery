/**
 * Obsidian declares theme colours on `body.theme-dark` / `body.theme-light`.
 * A `.print.theme-light` subtree inside a dark body inherits the dark values
 * because the custom properties were already resolved on the parent, so the
 * PDF would print light text on a light background. Re-declare the light
 * theme's custom properties on the print root instead of mutating the app.
 *
 * Obsidian's base theme only keeps the raw palette (`--color-base-*`) on the
 * theme class; every derived colour — `--text-normal`, `--background-primary`,
 * `--text-muted`, the heading colours — is declared on `body` as
 * `var(--color-base-*)`. Those declarations are substituted once on the body,
 * so a child that merely overrides the palette inherits the dark result. The
 * patch therefore re-declares the body-level layer on the print root as well,
 * which makes each `var()` resolve against the light palette in the same rule.
 */

let cache = null;

export function invalidateLightThemeCache() {
  cache = null;
}

export function buildLightThemePatch(documentRef) {
  if (!documentRef) return "";
  if (cache && cache.document === documentRef) return cache.css;
  const palette = new Map();
  const derived = new Map();
  let sheets = [];
  try {
    sheets = [...documentRef.styleSheets];
  } catch {
    return "";
  }
  for (const sheet of sheets) {
    let rules;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin stylesheets cannot be inspected; the app's theme is local.
      continue;
    }
    collect(rules, palette, derived);
  }
  // Derived layer first: for a name declared in both layers the palette must
  // win, and that is the later declaration in the same rule.
  const lines = [];
  for (const [name, value] of derived) lines.push(`${name}: ${value};`);
  for (const [name, value] of palette) lines.push(`${name}: ${value};`);
  const css = lines.length ? `.print.theme-light {\n  ${lines.join("\n  ")}\n}` : "";
  cache = { document: documentRef, css };
  return css;
}

function collect(rules, palette, derived) {
  if (!rules) return;
  for (const rule of rules) {
    if (rule.cssRules && String(rule.conditionText ?? "").trim() !== "") {
      collect(rule.cssRules, palette, derived);
      continue;
    }
    if (!rule.selectorText || !rule.style) continue;
    const light = targetsLightRoot(rule.selectorText);
    const host = !light && targetsHostRoot(rule.selectorText);
    if (!light && !host) continue;
    const target = light ? palette : derived;
    for (let index = 0; index < rule.style.length; index += 1) {
      const name = rule.style[index];
      if (!name.startsWith("--")) continue;
      const value = rule.style.getPropertyValue(name).trim();
      if (value) target.set(name, value);
    }
  }
}

/** Only rules that target the theme root itself define its variables. A rule
 * such as `.theme-light .cm-editor { --x }` must not be lifted to the root. */
function targetsLightRoot(selectorText) {
  return String(selectorText).split(",").some((part) => {
    const selector = part.trim();
    return selector === ".theme-light" || /(^|[\s>+~])\.theme-light$/.test(selector);
  });
}

/** `body`/`html`/`:root` carry the derived layer. `body.theme-dark` does not:
 * its declarations are literals for the theme that must not be lifted. */
function targetsHostRoot(selectorText) {
  return String(selectorText).split(",").some((part) => {
    const selector = part.trim();
    return selector === "body" || selector === "html" || selector === ":root";
  });
}
