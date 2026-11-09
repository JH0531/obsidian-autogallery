// AG-S22-01 — 命令面板里输入 AutoGallery。
import { prepare, restore, sleep, sendKeys, shotElement, stillPath, focusWindow, pageEval, movePointer } from "../lib/scene.mjs";

const ctx = await prepare({ note: "20-命令与撤销.md", mode: "source" });
await focusWindow();

// A previous run may have left the palette open; without this the old query is
// kept and the typed text is appended to it.
await sendKeys("escape");
await sleep(250);
await sendKeys("ctrl+p");
await sleep(550);
await sendKeys("AutoGallery");
await sleep(800);

// The ag-recording class squeezes the palette rows (its badges overlap the
// title). Element shots do not need the chrome hidden, so it is dropped here.
await pageEval('document.body.classList.remove("ag-recording"); return true;');
await sleep(250);

// Park the pointer far from any link: Obsidian keeps a page-preview popup alive
// while the pointer rests on one, and it floats over the palette.
await movePointer(
  Math.round(ctx.calib.origin.screen.x + 1150 * ctx.calib.scale.x),
  Math.round(ctx.calib.origin.screen.y + 770 * ctx.calib.scale.y)
);
await sleep(400);

// Wait for the result list to settle: the palette grows as rows arrive, and a
// rect measured mid-growth crops the bottom off.
for (let i = 0; i < 20; i++) {
  const n = await pageEval('return document.querySelectorAll(".prompt-results .suggestion-item").length;');
  if (n >= 4) break;
  await sleep(150);
}
await sleep(200);

const out = stillPath("AG-S22-01");
await shotElement(ctx, ".prompt", out, { pad: 18 });

await sendKeys("escape");
await sleep(200);
await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({ out, size: statSync(out).size }, null, 1));
