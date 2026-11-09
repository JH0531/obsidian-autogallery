// AG-A10-01 — 拖角标放大，再拖回原宽（循环）。
//
// The clip has to show both directions, and the pointer has to travel a straight
// line between two fixed points. The corner moves with the picture, so its grown
// position is measured first (a dry drag, undone), and the take then runs between
// those two points only. A drag computed from a guess would drift and the return
// would land on a different width.
import { join } from "node:path";
import { prepare, restore, hover, sleep, pageEval, dragScreen, screenOf, frameRegion, movePointer, motionPath, CACHE, encodeMp4, loopCloses } from "../lib/scene.mjs";
import { startGdigrab } from "../record.mjs";
import { spawnSync } from "node:child_process";

const ctx = await prepare({ note: "09-拖宽与对齐.md", mode: "source" });
await pageEval(`
  const el = document.querySelector(".image-embed");
  el.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 460));
  return true;
`);
await hover(ctx.calib, ".image-embed");
await sleep(500);

const geo = () => pageEval(`
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
  const corner = document.querySelector(".image-resize-corner") || document.querySelector(".ag-resize-fallback");
  return {
    embed: rect(document.querySelector(".image-embed")),
    corner: rect(corner),
    arrows: [...document.querySelectorAll(".ag-align-action")].map(rect)
  };
`);

const centerOf = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const start0 = await geo();
if (!start0.corner) throw new Error("角标未出现");

const a = centerOf(start0.corner);
const aScreen = screenOf(ctx.calib, a);
const dx = Math.round(210 * ctx.calib.scale.x);

// Dry run: measure where the corner lands once the picture is wider, then undo.
await movePointer(aScreen.x, aScreen.y, 4);
await sleep(280);
await dragScreen(aScreen, { x: aScreen.x + dx, y: aScreen.y }, { holdMs: 140, dwellMs: 300 });
await sleep(520);
const grown = await geo();
if (!grown.corner) throw new Error("放大后角标消失");
const b = centerOf(grown.corner);
const bScreen = screenOf(ctx.calib, b);

await dragScreen(bScreen, aScreen, { holdMs: 140, dwellMs: 300 });
await sleep(520);
const back = await geo();

// Crop: the picture plus the room it grows into, measured on both states.
const left = Math.min(start0.embed.x, grown.embed.x) - 14;
const right = Math.max(start0.embed.x + start0.embed.w, grown.embed.x + grown.embed.w) + 40;
const top = Math.min(start0.embed.y, grown.embed.y) - 14;
const bottom = Math.max(start0.embed.y + start0.embed.h, grown.embed.y + grown.embed.h) + 34;
const region = frameRegion(ctx, { x: left, y: top, w: right - left, h: bottom - top });

await movePointer(aScreen.x, aScreen.y, 4);
await sleep(420);

const raw = join(CACHE, "AG-A10-01-raw.mp4");
const out = motionPath("AG-A10-01", "mp4");
const marks = {};
const t0 = Date.now();
const mark = (n) => { marks[n] = +((Date.now() - t0) / 1000).toFixed(2); };

const rec = startGdigrab({ win: ctx.win, file: raw, seconds: 5.6, fps: 30 });
await sleep(450);
mark("start");
await sleep(300);

await dragScreen(aScreen, bScreen, { holdMs: 140, dwellMs: 320 });
await sleep(340);
await dragScreen(bScreen, aScreen, { holdMs: 140, dwellMs: 320 });
await sleep(380);
mark("end");
await rec.done;

const settled = await geo();
const from0 = Math.max(0, marks.start - 0.05);
const to0 = Math.min(marks.end + 0.1, 5.6);
const trimmed = join(CACHE, "AG-A10-01-loop.mp4");
spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from0), "-to", String(to0), "-i", raw,
  "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", trimmed], { windowsHide: true });
encodeMp4(trimmed, out, { fps: 30, region, width: 1200 });
await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({
  widths: [start0.embed.w, grown.embed.w, back.embed.w, settled.embed.w],
  points: { a, b }, region, marks, closes: loopCloses(out), out, size: statSync(out).size
}, null, 1));
