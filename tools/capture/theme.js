// Body of an async function, evaluated inside the renderer by lib/theme.mjs.
//
// Switch the app theme in place. `setConfig` writes .obsidian/appearance.json
// and Obsidian repaints without a reload, so one session can alternate themes.
// `obsidian` is the dark theme, `moonstone` the light one.
//
// The class on <body> flips before the workspace finishes repainting, so the
// wait continues past the class change instead of trusting it.
const __configId = __theme === "light" ? "moonstone" : "obsidian";
const __sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (typeof app?.vault?.setConfig !== "function") return { ok: false, reason: "no setConfig" };

const __before = app.vault.getConfig?.("theme") ?? null;
app.vault.setConfig("theme", __configId);

for (let i = 0; i < 40; i += 1) {
  if (document.body.classList.contains(`theme-${__theme}`)) {
    await __sleep(280);
    return {
      ok: true,
      theme: __theme,
      before: __before,
      after: app.vault.getConfig?.("theme") ?? null,
      bg: getComputedStyle(document.body).backgroundColor
    };
  }
  await __sleep(100);
}
return { ok: false, theme: __theme, before: __before, reason: "class did not flip" };
