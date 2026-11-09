// AG-V10-01 — 对齐箭头走一整圈：左 → 中 → 右 → 中 → 左（循环）。
//
// The note changed (the picture no longer carries ag:width / ag:side), so the
// starting side is read from the DOM instead of assumed, and the walk is written
// out step by step: the old version derived the number of clicks from the start
// side and stopped halfway through the cycle.
//
// The arrows collapse when the pointer leaves the cell, so every step re-hovers
// the picture and re-reads the arrow before clicking. Each click also writes the
// current width (that is the feature), which is why the note ends with ag:width
// even though the picture looks the same; the scene restores the source after.
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

const sideState = () => pageEval(`
  const has = (side) => !!document.querySelector(\`.ag-align-action[data-side="\${side}"]\`);
  const left = has("left");
  const right = has("right");
  return left && right ? "center" : left ? "right" : right ? "left" : "none";
`);
const embedBox = () => pageEval(`
  const el = document.querySelector(".image-embed");
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
`);

const startSide = await sideState();
if (startSide === "none") throw new Error("对齐箭头未出现");

// The frame is the whole text column: the picture itself moves between the three
// alignments, so a crop tight to the picture would lose it on the first click.
const box = await embedBox();
const region = frameRegion(ctx, { x: 208, y: box.y - 26, w: 784, h: box.h + 78 });

const clickSide = async (side) => {
  await hover(ctx.calib, ".image-embed");
  await sleep(300);
  const r = await pageEval(`
    const el = document.querySelector('.ag-align-action[data-side="${side}"]');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  `);
  if (!r) throw new Error(`找不到 ${side} 箭头（当前 ${await sideState()}）`);
  const p = screenOf(ctx.calib, r);
  await movePointer(p.x, p.y, 5);
  await sleep(260);
  await dragScreen(p, p, { holdMs: 50, dwellMs: 140 });
  await sleep(360);
  return sideState();
};

// Park on the picture so the first frame already shows the arrows.
const parkPoint = screenOf(ctx.calib, { x: box.x + box.w / 2, y: box.y + box.h / 2 });
await movePointer(parkPoint.x, parkPoint.y, 5);
await sleep(500);

// The take assumes it starts left-aligned; a previous run can leave the image
// centred or right-aligned, and then the first `right` click has no target.
let start = await sideState();
for (let i = 0; i < 3 && start !== "left"; i += 1) {
  await clickSide("left");
  start = await sideState();
}

const raw = join(CACHE, "AG-V10-01-raw.mp4");
const out = motionPath("AG-V10-01", "mp4");
const marks = {};
const t0 = Date.now();
const mark = (n) => { marks[n] = +((Date.now() - t0) / 1000).toFixed(2); };

const rec = startGdigrab({ win: ctx.win, file: raw, seconds: 11, fps: 30 });
await sleep(480);
mark("start");
await sleep(320);

const walk = [];
walk.push(await clickSide("right")); // left → center
walk.push(await clickSide("right")); // center → right
walk.push(await clickSide("left"));  // right → center
walk.push(await clickSide("left"));  // center → left

// Back onto the picture, away from any arrow.
await movePointer(parkPoint.x, parkPoint.y, 5);
await sleep(520);
mark("end");
await rec.done;

const from0 = Math.max(0, marks.start - 0.05);
const to0 = Math.min(marks.end + 0.14, 11);
const trimmed = join(CACHE, "AG-V10-01-loop.mp4");
spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from0), "-to", String(to0), "-i", raw,
  "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", trimmed], { windowsHide: true });
encodeMp4(trimmed, out, { fps: 30, region, width: 1200 });
await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({
  startSide, walk, region, marks, closes: loopCloses(out), out, size: statSync(out).size
}, null, 1));
