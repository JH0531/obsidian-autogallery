// AG-S18-01 — PDF 导出对话框（版式预览）。
import { prepare, restore, sleep, pageEval, shotElement, stillPath, reloadPlugin, clickText } from "../lib/scene.mjs";

const ctx = await prepare({ note: "17-PDF导出.md", mode: "source" });
await reloadPlugin();
await pageEval(`
  app.commands.executeCommandById("obsidian-autogallery:export-pdf");
  return true;
`);

// The dialog renders a preview sheet first and only then settles; cropping early
// catches the "正在准备预览" state.
for (let i = 0; i < 40; i++) {
  const ready = await pageEval(`
    const sheet = document.querySelector(".ag-pdf-export__sheet");
    const status = document.querySelector(".ag-pdf-export__status");
    const busy = status ? /准备/.test(status.textContent || "") : false;
    return !!(sheet && sheet.offsetHeight > 100 && !busy);
  `);
  if (ready) break;
  await sleep(300);
}
await sleep(500);

const out = stillPath("AG-S18-01");
await shotElement(ctx, ".modal-container .modal", out, { pad: 12 });

await clickText(ctx, ".modal-container", "取消").catch(() => {});
await sleep(400);
await restore(ctx);
console.log(JSON.stringify({ out }));
