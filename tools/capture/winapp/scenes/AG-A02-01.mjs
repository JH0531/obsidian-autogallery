// AG-A02-01 — 插件关闭时，同一篇笔记一路滚到底再滚回（与 AG-V00-01 对照）。
//
// Same note and the same scroll as AG-V00-01, with the plugin switched off: the
// pictures fall back to Obsidian's inline layout, so the two clips are a direct
// before/after of what the plugin does to a page.
//
// The plugin is disabled *before* the recorder starts and re-enabled after it
// stops. Toggling it inside the clip would make the first and last frames
// different pages, and the loop would never close.
import { join } from "node:path";
import { prepare, restore, sleep, pageEval, motionPath, CACHE, encodeMp4, loopCloses } from "../lib/scene.mjs";
import { startGdigrab } from "../record.mjs";
import { spawnSync } from "node:child_process";

const ctx = await prepare({ note: "00-效果总览.md", mode: "preview" });
await pageEval(`await app.plugins.disablePlugin("obsidian-autogallery"); return true;`);
await sleep(1600);

const span = await pageEval(`
  const sc = document.querySelector(".markdown-preview-view") || document.querySelector(".cm-scroller");
  if (sc) sc.scrollTop = 0;
  await new Promise((r) => setTimeout(r, 600));
  return sc ? Math.round(sc.scrollHeight - sc.clientHeight) : 0;
`);
if (!span) throw new Error("读不到可滚动高度");

const glide = (to, ms) => pageEval(`
  const sc = document.querySelector(".markdown-preview-view") || document.querySelector(".cm-scroller");
  const start = sc.scrollTop;
  const end = Math.max(0, Math.min(sc.scrollHeight - sc.clientHeight, ${to}));
  const t0 = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ${ms});
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      sc.scrollTop = start + (end - start) * e;
      if (k < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
  return Math.round(sc.scrollTop);
`);

const ms = Math.round(Math.min(10000, Math.max(1600, span / 0.75)));

const raw = join(CACHE, "AG-A02-01-raw.mp4");
const out = motionPath("AG-A02-01", "mp4");
const marks = {};
const t0 = Date.now();
const mark = (n) => { marks[n] = +((Date.now() - t0) / 1000).toFixed(2); };

const seconds = (ms * 2) / 1000 + 2.4;
const rec = startGdigrab({ win: ctx.win, file: raw, seconds, fps: 30 });
await sleep(600);
mark("start");
await sleep(320);

const bottom = await glide(span, ms);
await sleep(340);
const back = await glide(0, ms);
await sleep(380);
mark("end");
await rec.done;

await pageEval(`await app.plugins.enablePlugin("obsidian-autogallery"); return true;`).catch(() => {});
await sleep(1400);

const from0 = Math.max(0, marks.start - 0.05);
const to0 = Math.min(marks.end + 0.12, seconds);
const trimmed = join(CACHE, "AG-A02-01-loop.mp4");
spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from0), "-to", String(to0), "-i", raw,
  "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", trimmed], { windowsHide: true });
// 900px wide, CRF 27: with the plugin off the page is four times taller, so the
// clip is ~21s. At 1200px it cannot fit the 6 MB budget without visible blocking;
// the subject is a layout comparison, and 900px still reads.
encodeMp4(trimmed, out, { fps: 30, crf: 27, width: 900 });
await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({ span, ms, bottom, back, marks, closes: loopCloses(out), out, size: statSync(out).size }, null, 1));
