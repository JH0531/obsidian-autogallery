// AG-S20-01 — 设置页七分区目录，停在页面开头。
//
// The previous take captured whatever scroll position the settings tab happened
// to keep between runs, so the frame started mid-page. The pane is reset to the
// top first; the point of this still is the nav row, which only exists there.
import { prepare, restore, sleep, pageEval, stillPath, settingsTarget, shotWindowByTitle } from "../lib/scene.mjs";
import { evalAt } from "../cdp.mjs";

const ctx = await prepare({ note: "19-设置页.md", mode: "source" });
await pageEval(`app.setting.open(); app.setting.openTabById("obsidian-autogallery"); return true;`);
await sleep(1400);

const target = await settingsTarget();
const top = await evalAt(target, `
  const sc = document.querySelector(".vertical-tab-content");
  if (!sc) return null;
  // Two passes: the pane may still be animating open when the first assignment
  // lands, and a late layout pass can restore the old offset.
  sc.scrollTop = 0;
  await new Promise((r) => setTimeout(r, 400));
  sc.scrollTop = 0;
  await new Promise((r) => setTimeout(r, 400));
  return Math.round(sc.scrollTop);
`);
await sleep(300);

const out = stillPath("AG-S20-01");
await shotWindowByTitle(ctx, "设置|Settings", out);

await evalAt(target, `app.setting.close(); return true;`).catch(() => {});
await sleep(400);
await restore(ctx);
console.log(JSON.stringify({ out, top }));
