// AG-A07-02 — 拖动行底横条：整行变高，列宽比例不变（循环）。
//
// The bar belongs to the second gallery row, not the first. Growing the first
// row lets the packer pull a fourth picture into it (3 cells become 4, measured),
// which turns the clip into a different demo and makes the return trip land on a
// composition that no longer exists. The second row holds the last three
// pictures, so the same gesture only changes its height.
//
// The crop is measured from the rows: the editor scroll offset is not stable
// between runs, and the drag needs ~90px of extra room at the bottom.
import { join } from "node:path";
import { prepare, restore, hover, sleep, pageEval, dragScreen, screenOf, frameRegion, movePointer, motionPath, CACHE, encodeMp4, loopCloses } from "../lib/scene.mjs";
import { startGdigrab } from "../record.mjs";
import { spawnSync } from "node:child_process";

const ctx = await prepare({ note: "06-画廊手柄.md", mode: "source" });
await pageEval(`
  const sc = document.querySelector(".cm-scroller");
  if (sc) sc.scrollTop = 0;
  await new Promise((r) => setTimeout(r, 420));
  return true;
`);

await hover(ctx.calib, ".image-embed");
await sleep(500);

const measure = () => pageEval(`
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const bars = [...document.querySelectorAll(".ag-gallery-height")].map(rect).sort((a, b) => a.y - b.y);
  const rows = new Map();
  for (const el of document.querySelectorAll(".image-embed")) {
    const r = el.getBoundingClientRect();
    const k = Math.round(r.y / 8) * 8;
    if (!rows.has(k)) rows.set(k, []);
    rows.get(k).push({ y: r.y, h: r.height });
  }
  const list = [...rows.entries()]
    .map(([top, cells]) => ({ top, bottom: Math.max(...cells.map((c) => c.y + c.h)) }))
    .sort((a, b) => a.top - b.top)
    .slice(0, 2);
  return { bars, rows: list, second: bars[1] ?? null };
`);

const geo = await measure();
if (!geo.second) throw new Error("第二行行底横条未出现");

const barCenter = (bar) => screenOf(ctx.calib, { x: bar.x + bar.w / 2, y: bar.y + bar.h / 2 });
const start = barCenter(geo.second);
await movePointer(start.x, start.y, 4);
await sleep(500);

const top = geo.rows[0].top - 12;
const bottom = geo.rows[1].bottom + 96;
const region = frameRegion(ctx, { x: 208, y: top, w: 784, h: bottom - top });

const raw = join(CACHE, "AG-A07-02-raw.mp4");
const out = motionPath("AG-A07-02", "mp4");
const dy = Math.round(60 * ctx.calib.scale.y);
const marks = {};
const t0 = Date.now();
const mark = (n) => { marks[n] = +((Date.now() - t0) / 1000).toFixed(2); };

const rec = startGdigrab({ win: ctx.win, file: raw, seconds: 5, fps: 30 });
await sleep(420);
mark("start");
await sleep(300);

await dragScreen(start, { x: start.x, y: start.y + dy }, { holdMs: 120, dwellMs: 320 });
await sleep(380);

// The bar follows the pointer one-to-one, so the way back starts where the bar
// now is — read again rather than assumed, because the row may have re-packed.
const grown = await measure();
const back = barCenter(grown.bars[1]);
await dragScreen(back, start, { holdMs: 120, dwellMs: 320 });
await sleep(380);
mark("end");
await rec.done;

const settled = await measure();
const from0 = Math.max(0, marks.start - 0.05);
const to0 = Math.min(marks.end + 0.1, 5);
const trimmed = join(CACHE, "AG-A07-02-loop.mp4");
spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from0), "-to", String(to0), "-i", raw,
  "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", trimmed], { windowsHide: true });
encodeMp4(trimmed, out, { fps: 30, region, width: 1200 });
await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({
  before: geo.rows, grown: grown.rows, settled: settled.rows,
  region, marks, closes: loopCloses(out), out, size: statSync(out).size
}, null, 1));
