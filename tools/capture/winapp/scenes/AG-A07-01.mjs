// AG-A07-01 — 拖动竖向分隔条：相邻两格此消彼长（循环）。
//
// Two changes over the previous take:
//   * the frame is cropped to the gallery block, so the "四类手柄" table below it
//     is not in shot — the clip answers one question, not two;
//   * the pointer is parked on the divider before the recorder starts and put
//     back there before it stops, so the loop neither enters nor leaves with a
//     stray hover sliding across the row.
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

// Handles only exist while the row is hovered, so the reveal comes first.
await hover(ctx.calib, ".image-embed");
await sleep(500);

const geo = await pageEval(`
  const rect = (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const dividers = [...document.querySelectorAll(".ag-gallery-divider")].map(rect);
  const embeds = [...document.querySelectorAll(".image-embed")].map(rect);
  const rows = new Map();
  for (const e of embeds) { const k = Math.round(e.y / 8) * 8; if (!rows.has(k)) rows.set(k, []); rows.get(k).push(e); }
  const list = [...rows.entries()]
    .map(([top, cells]) => ({ top, cells, bottom: Math.max(...cells.map((c) => c.y + c.h)) }))
    .sort((x, y) => x.top - y.top)
    .slice(0, 2);
  const second = dividers.filter((d) => d.y >= list[1].top - 4 && d.y < list[1].bottom).sort((a, b) => a.x - b.x);
  return { rows: list, target: second[0] ?? null };
`);
if (!geo.target) throw new Error("第二行分隔条未出现");

const from = screenOf(ctx.calib, { x: geo.target.x + geo.target.w / 2, y: geo.target.y + geo.target.h / 2 });
await movePointer(from.x, from.y, 4);
await sleep(500);

// Crop: the two gallery rows only, measured rather than assumed — the editor
// scroll offset differs between runs, and a fixed y framed the table instead.
const top = Math.min(...geo.rows.map((r) => r.top)) - 12;
const bottom = Math.max(...geo.rows.map((r) => r.bottom)) + 16;
const region = frameRegion(ctx, { x: 208, y: top, w: 784, h: bottom - top });

const raw = join(CACHE, "AG-A07-01-raw.mp4");
const out = motionPath("AG-A07-01", "mp4");
const shift = Math.round(150 * ctx.calib.scale.x);
const marks = {};
const t0 = Date.now();
const mark = (n) => { marks[n] = +((Date.now() - t0) / 1000).toFixed(2); };

// Column widths on both sides of the drag: ag:crop stores two decimals, so the
// return trip can land a pixel off. Measured, not assumed.
const widths = () => pageEval(`
  return [...document.querySelectorAll(".image-embed")].slice(3, 6)
    .map((el) => Math.round(el.getBoundingClientRect().width));
`);
const widthBefore = await widths();

const rec = startGdigrab({ win: ctx.win, file: raw, seconds: 4.8, fps: 30 });
await sleep(420);
mark("start");
await sleep(300);

await dragScreen(from, { x: from.x + shift, y: from.y }, { holdMs: 130, dwellMs: 280 });
await sleep(320);
await dragScreen({ x: from.x + shift, y: from.y }, from, { holdMs: 130, dwellMs: 280 });
await sleep(360);
mark("end");
await rec.done;

const from0 = Math.max(0, marks.start - 0.05);
const to0 = Math.min(marks.end + 0.1, 4.8);
const trimmed = join(CACHE, "AG-A07-01-loop.mp4");
spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from0), "-to", String(to0), "-i", raw,
  "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", trimmed], { windowsHide: true });
encodeMp4(trimmed, out, { fps: 30, region, width: 1200 });
const widthAfter = await widths();
await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({ widthBefore, widthAfter, region, marks, closes: loopCloses(out), out, size: statSync(out).size }, null, 1));
