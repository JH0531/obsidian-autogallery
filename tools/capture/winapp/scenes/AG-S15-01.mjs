// AG-S15-01 — 设置页「配置管理」的可操作区。
//
// Only the controls: the import row and the template list. The schema block
// above them is prose explaining the file format, and prose belongs in the
// document, not in a screenshot — it is also 1376px tall, which is why the
// previous take framed a wall of text and almost none of the controls.
import { prepare, restore, sleep, pageEval, stillPath, settingsTarget, windowByTitle, shotWindowCss } from "../lib/scene.mjs";
import { evalAt } from "../cdp.mjs";

const ctx = await prepare({ note: "14-布局模板.md", mode: "source" });
await pageEval(`app.setting.open(); app.setting.openTabById("obsidian-autogallery"); return true;`);
await sleep(1400);

const target = await settingsTarget();
const win = await windowByTitle("设置|Settings");

const geo = await evalAt(target, `
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const nav = [...document.querySelectorAll(".ag-nav-item")].find((el) => el.textContent.trim() === "配置管理");
  if (!nav) return { error: "no nav" };
  nav.click();
  await sleep(700);

  const importRow = [...document.querySelectorAll(".setting-item")].find((el) => /导入配置/.test(el.textContent));
  const list = document.querySelector(".ag-profile-list");
  if (!importRow || !list) return { error: "no controls" };
  // Park the controls at the top of the pane so nothing of the schema block
  // above them can leak into the crop.
  importRow.scrollIntoView({ block: "start" });
  await sleep(500);

  const a = importRow.getBoundingClientRect();
  const b = list.getBoundingClientRect();
  return {
    rect: { x: a.x, y: a.y, w: a.width, h: b.bottom - a.top },
    inner: { w: innerWidth, h: innerHeight },
    rows: list.children.length
  };
`);
if (geo.error) throw new Error(`配置管理区未就绪：${geo.error}`);

const out = stillPath("AG-S15-01");
await shotWindowCss(ctx, { hwnd: win.hwnd, rect: geo.rect, inner: geo.inner, out, pad: 14 });

await evalAt(target, `app.setting.close(); return true;`).catch(() => {});
await sleep(400);
await restore(ctx);
console.log(JSON.stringify({ out, geo }));
