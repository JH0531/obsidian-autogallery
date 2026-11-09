// AG-V00-01 — 通读总览：一路滚到文档底部，再滚回顶部（循环）。
//
// The previous take scrolled one screen and came back, which never showed the
// gallery handling a full page. The wheel route (`ui scroll --wheel`) exits 1
// without a target element on this build, so the scroll is driven by a rAF ease
// inside the page: same smoothness, and it cannot overshoot or fight the
// editor's own anchoring.
import { join } from "node:path";
import { prepare, restore, sleep, pageEval, motionPath, CACHE, encodeMp4, loopCloses } from "../lib/scene.mjs";
import { startGdigrab } from "../record.mjs";
import { spawnSync } from "node:child_process";

const ctx = await prepare({ note: "00-效果总览.md", mode: "preview" });
const span = await pageEval(`
  const sc = document.querySelector(".markdown-preview-view") || document.querySelector(".cm-scroller");
  if (sc) sc.scrollTop = 0;
  await new Promise((r) => setTimeout(r, 500));
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

// Scroll speed is a reading speed, not a travel speed: at ~1400px/s the rows
// went by faster than the eye can follow. 550px/s, capped at 4200ms per leg.
const ms = Math.round(Math.min(4200, Math.max(1600, span / 0.55)));

const raw = join(CACHE, "AG-V00-01-raw.mp4");
const out = motionPath("AG-V00-01", "mp4");
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

const from0 = Math.max(0, marks.start - 0.05);
const to0 = Math.min(marks.end + 0.12, seconds);
const trimmed = join(CACHE, "AG-V00-01-loop.mp4");
spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from0), "-to", String(to0), "-i", raw,
  "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", trimmed], { windowsHide: true });
encodeMp4(trimmed, out, { fps: 30 });
await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({ span, ms, bottom, back, marks, closes: loopCloses(out), out, size: statSync(out).size }, null, 1));
