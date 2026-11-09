import { prepare, pageEval, restore, sleep } from "../lib/scene.mjs";

const ctx = await prepare({ note: "19-设置页.md", mode: "source" });
await pageEval(`
  app.setting.open();
  app.setting.openTabById("obsidian-autogallery");
  await new Promise((r) => setTimeout(r, 900));
  return true;
`);
await sleep(600);

const info = await pageEval(`
  const pick = (sel, n = 6) => [...document.querySelectorAll(sel)].slice(0, n).map((el) => {
    const r = el.getBoundingClientRect();
    return { cls: String(el.className).slice(0, 46), text: (el.textContent || "").trim().slice(0, 18),
             r: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] };
  });
  const modal = document.querySelector(".mod-settings");
  return {
    modal: modal ? { r: (() => { const b = modal.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })() } : null,
    nav: pick(".ag-section-nav, .ag-nav-item, [class*='section-nav']", 12),
    search: pick(".ag-setting-search-input, input[type='search'], .setting-search input", 3),
    items: pick(".setting-item", 4),
    reset: pick(".clickable-icon[aria-label*='恢复'], .ag-reset, [data-ag-reset]", 4),
    profiles: pick("[class*='profile']", 6)
  };
`);
console.log(JSON.stringify(info, null, 1));
await restore(ctx);
