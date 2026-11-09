// AG-A13-01 — 从功能栏按钮进入裁剪，横向多裁一点，保存；再进入清除，还原（循环）。
//
// The entry is part of the clip now: the pointer starts outside the picture, the
// hover reveals the action bar, and the crop button is clicked on camera. The old
// take began with the dialog already open, which skipped the only step a reader
// has to find.
//
// The drag cuts more width than height, so the result has a visibly different
// aspect ratio — that is what makes the width routing react afterwards. The frame
// is cropped to the dialog: the note below it ("裁成方形") is not part of the
// story and the dialog covers the rest.
import { join } from "node:path";
import { prepare, restore, hover, sleep, pageEval, dragScreen, screenOf, frameRegion, movePointer, clickText, closeModal, motionPath, LANG, CACHE, encodeMp4, loopCloses } from "../lib/scene.mjs";
import { startGdigrab } from "../record.mjs";
import { spawnSync } from "node:child_process";

const ctx = await prepare({ note: "11-裁剪.md", mode: "source" });
const headingTop = await pageEval(`
  const el = document.querySelector(".image-embed");
  el.scrollIntoView({ block: "center" });
  await new Promise((r) => setTimeout(r, 420));
  // Push the note up so the next heading ("裁成方形") drops below the dialog:
  // the dialog owns 60..740, and that heading sat at ~608 right behind it.
  const sc = document.querySelector(".cm-scroller");
  if (sc) sc.scrollTop -= 150;
  await new Promise((r) => setTimeout(r, 460));
  const heading = [...document.querySelectorAll(".HyperMD-header, .cm-line, h1, h2, h3")]
    .find((node) => node.textContent.trim() === "裁成方形");
  return heading ? Math.round(heading.getBoundingClientRect().top) : null;
`);
await sleep(300);

const PARK = screenOf(ctx.calib, { x: 1120, y: 720 });
const toScreen = (p) => screenOf(ctx.calib, p);

const boxOf = (selector) => pageEval(`
  const el = document.querySelector(${JSON.stringify(selector)});
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
`);

const modalReady = async () => {
  for (let i = 0; i < 30; i++) {
    const ok = await pageEval(`
      const img = document.querySelector(".ag-crop-modal img");
      return !!(img && img.naturalWidth > 0 && document.querySelectorAll(".ag-crop-modal [data-handle]").length >= 8);
    `);
    if (ok) return true;
    await sleep(200);
  }
  return false;
};

// The dialog is the subject, so the frame is sized to hold all of it: 880×680
// at (160,60), plus 10px of margin. An earlier take shortened the frame to stop
// above the next heading, which cut the dialog's button row — the wrong trade:
// the reader needs the controls, not the absence of a heading that the dialog
// covers anyway.
const region = frameRegion(ctx, { x: 150, y: 50, w: 900, h: 700 });

await movePointer(PARK.x, PARK.y, 6);
await sleep(600);

const raw = join(CACHE, "AG-A13-01-raw.mp4");
const out = motionPath("AG-A13-01", "mp4");
const marks = {};
const t0 = Date.now();
const mark = (n) => { marks[n] = +((Date.now() - t0) / 1000).toFixed(2); };

const rec = startGdigrab({ win: ctx.win, file: raw, seconds: 18, fps: 30 });
await sleep(520);
mark("start");
await sleep(320);

// 1. Hover the picture: the action bar appears.
const pic = await boxOf(".image-embed");
await movePointer(toScreen(pic).x, toScreen(pic).y, 6);
await sleep(520);

// 2. Click the crop button.
const cropBtn = await boxOf(".ag-crop-action");
if (!cropBtn) throw new Error("裁剪按钮未出现");
await movePointer(toScreen(cropBtn).x, toScreen(cropBtn).y, 5);
await sleep(300);
await dragScreen(toScreen(cropBtn), toScreen(cropBtn), { holdMs: 60, dwellMs: 160 });
if (!(await modalReady())) throw new Error("裁剪对话框未打开");
await sleep(520);

// 3. Cut the width harder than the height.
const handle = await boxOf('.ag-crop-modal [data-handle="se"]');
const grab = { x: handle.x - 6, y: handle.y - 6 };
await movePointer(toScreen(grab).x, toScreen(grab).y, 5);
await sleep(260);
await dragScreen(toScreen(grab), {
  x: toScreen(grab).x - Math.round(190 * ctx.calib.scale.x),
  y: toScreen(grab).y - Math.round(46 * ctx.calib.scale.y)
}, { holdMs: 180, dwellMs: 320 });
await sleep(420);

// 4. Save.
await clickText(ctx, ".ag-crop-modal", LANG === "en" ? "Save" : "保存");
await sleep(900);

// 5. Reopen and clear, which is what returns the picture to its original state.
const pic2 = await boxOf(".image-embed");
await movePointer(toScreen(pic2).x, toScreen(pic2).y, 5);
await sleep(460);
const cropBtn2 = await boxOf(".ag-crop-action");
await movePointer(toScreen(cropBtn2).x, toScreen(cropBtn2).y, 5);
await sleep(300);
await dragScreen(toScreen(cropBtn2), toScreen(cropBtn2), { holdMs: 60, dwellMs: 160 });
if (!(await modalReady())) throw new Error("第二次打开裁剪对话框失败");
await sleep(460);
await clickText(ctx, ".ag-crop-modal", LANG === "en" ? "Clear crop" : "清除剪裁");
await sleep(500);
await closeModal(ctx, { container: ".ag-crop-modal" });
await sleep(420);

await movePointer(PARK.x, PARK.y, 5);
await sleep(600);
mark("end");
await rec.done;

const from0 = Math.max(0, marks.start - 0.05);
const to0 = Math.min(marks.end + 0.14, 18);
const trimmed = join(CACHE, "AG-A13-01-loop.mp4");
spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from0), "-to", String(to0), "-i", raw,
  "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", trimmed], { windowsHide: true });
encodeMp4(trimmed, out, { fps: 30, region, width: 1200 });
await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({ headingTop, region, marks, closes: loopCloses(out), out, size: statSync(out).size }, null, 1));
