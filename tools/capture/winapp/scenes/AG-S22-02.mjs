// AG-S22-02 — 恢复默认的二次确认（静帧）。
import { prepare, restore, sleep, sendKeys, pageEval, shotElement, stillPath, focusWindow } from "../lib/scene.mjs";

const ctx = await prepare({ note: "20-命令与撤销.md", mode: "source" });
await focusWindow();
await sendKeys("escape");
await sleep(250);
await sendKeys("ctrl+p");
await sleep(550);
await sendKeys("恢复文档默认图片样式");
await sleep(700);
await sendKeys("enter");
await sleep(900);

const out = stillPath("AG-S22-02");
await shotElement(ctx, ".modal-container .modal", out, { pad: 14 });

await sendKeys("escape");
await sleep(200);
await restore(ctx);
console.log(JSON.stringify({ out }));
