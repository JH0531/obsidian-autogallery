// AG-V18-01 — 版式预览与分页预览切换；分页后滚到底再切回（循环）。
import { join } from "node:path";
import { prepare, restore, sleep, pageEval, clickText, motionPath, CACHE, encodeMp4, loopCloses, reloadPlugin, LANG } from "../lib/scene.mjs";
import { startGdigrab } from "../record.mjs";
import { spawnSync } from "node:child_process";

const ctx = await prepare({ note: "17-PDF导出.md", mode: "source" });
await reloadPlugin();
await pageEval(`app.commands.executeCommandById("obsidian-autogallery:export-pdf"); return true;`);
for (let i = 0; i < 40; i++) {
  const ready = await pageEval(`const s=document.querySelector(".ag-pdf-export__sheet"); return !!(s && s.offsetHeight > 100);`);
  if (ready) break;
  await sleep(300);
}
await sleep(600);

const raw = join(CACHE, "AG-V18-01-raw.mp4");
const out = motionPath("AG-V18-01", "mp4");
const marks = {};
const t0 = Date.now();
const mark = (n) => { marks[n] = +((Date.now() - t0) / 1000).toFixed(2); };

const rec = startGdigrab({ win: ctx.win, file: raw, seconds: 20, fps: 30 });
await sleep(600);
mark("start");
await sleep(300);

await clickText(ctx, ".modal-container", LANG === "en" ? "Paginated preview" : "分页预览");
for (let i = 0; i < 80; i++) {
  const pages = await pageEval(`return document.querySelectorAll(".ag-pdf-export__page canvas").length;`);
  if (pages > 0) break;
  await sleep(250);
}
await sleep(500);

// Walk to the bottom of the paginated preview so both pages are seen. Slower
// than a native smooth scroll: at the previous speed the pages went by in about
// half a second and the difference between them was unreadable.
await pageEval(`
  const holder = [...document.querySelectorAll(".ag-pdf-export__pages")].pop();
  let el = holder;
  while (el && el.scrollHeight <= el.clientHeight + 8) el = el.parentElement;
  if (!el) return false;
  const from = el.scrollTop;
  const to = el.scrollHeight - el.clientHeight;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 2200);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      el.scrollTop = from + (to - from) * e;
      if (k < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
  return true;
`);
await sleep(500);

await clickText(ctx, ".modal-container", LANG === "en" ? "Layout preview" : "版式预览");
await sleep(900);

// The layout preview keeps the scroll offset of the page it replaced, so it
// opens at the bottom too. Bring it back up before the clip ends, otherwise the
// loop starts at the top and stops at the bottom.
await pageEval(`
  const holder = document.querySelector(".ag-pdf-export__sheet");
  let el = holder;
  while (el && el.scrollHeight <= el.clientHeight + 8) el = el.parentElement;
  if (!el) return false;
  const from = el.scrollTop;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1400);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      el.scrollTop = from * (1 - e);
      if (k < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
  return true;
`);
await sleep(600);
mark("end");
await rec.done;

const from0 = Math.max(0, marks.start - 0.05);
const to0 = Math.min(marks.end + 0.15, 20);
const trimmed = join(CACHE, "AG-V18-01-loop.mp4");
spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from0), "-to", String(to0), "-i", raw,
  "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", trimmed], { windowsHide: true });
encodeMp4(trimmed, out, { fps: 30 });

await clickText(ctx, ".modal-container", LANG === "en" ? "Cancel" : "取消").catch(() => {});
await sleep(500);
await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({ marks, closes: loopCloses(out), out, size: statSync(out).size }, null, 1));
