// AG-S12-04 — 裁剪对话框（静帧）。
import { prepare, restore, hover, sleep, pageEval, clickCss, shotElement, stillPath, closeModal } from "../lib/scene.mjs";

const ctx = await prepare({ note: "11-裁剪.md", mode: "source" });
await pageEval(`
  const el = document.querySelector(".image-embed");
  el.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 300));
  return true;
`);
await hover(ctx.calib, ".image-embed");
await sleep(300);
await clickCss(".ag-crop-action", { settle: 1200 });

// The dialog paints its preview after the bitmap decodes; cropping before that
// catches an empty frame.
for (let i = 0; i < 25; i++) {
  const ready = await pageEval(`
    const img = document.querySelector(".ag-crop-modal img");
    return !!(img && img.naturalWidth > 0 && document.querySelectorAll(".ag-crop-modal [data-handle]").length >= 8);
  `);
  if (ready) break;
  await sleep(200);
}
await sleep(400);

const out = stillPath("AG-S12-04");
await shotElement(ctx, ".ag-crop-modal", out, { pad: 12 });

await closeModal(ctx);
await restore(ctx);
console.log(JSON.stringify({ out }));
