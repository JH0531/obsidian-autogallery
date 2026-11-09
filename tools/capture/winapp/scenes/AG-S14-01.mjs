// AG-S14-01 — 说明与布局对话框（静帧）。
import { prepare, restore, sleep, sendKeys, pageEval, shotElement, stillPath, focusWindow } from "../lib/scene.mjs";

const ctx = await prepare({ note: "13-对话框与重置.md", mode: "source" });
await focusWindow();
await pageEval(`
  const el = document.querySelector(".image-embed");
  if (el) { el.scrollIntoView({ block: "center" }); await new Promise((r) => setTimeout(r, 250)); }
  return true;
`);
// The annotation command is editor-scoped: the caret has to be in the note.
await pageEval(`
  const view = app.workspace.activeLeaf.view;
  view.editor?.focus?.();
  return true;
`);
await sleep(200);
await sendKeys("escape");
await sleep(200);
await sendKeys("ctrl+p");
await sleep(550);
await sendKeys("设置图片说明");
await sleep(700);
await sendKeys("enter");
await sleep(900);

const out = stillPath("AG-S14-01");
await shotElement(ctx, ".modal-container .modal", out, { pad: 14 });

await sendKeys("escape");
await sleep(200);
await restore(ctx);
console.log(JSON.stringify({ out }));
