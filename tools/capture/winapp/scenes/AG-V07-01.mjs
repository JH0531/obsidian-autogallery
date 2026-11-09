// AG-V07-01 — 并入下一行会自动绑定两行，解除绑定后图片回落（循环）。
//
// The behaviour this shows changed: `ag:rows` is no longer injected when a
// binding is released, so the row falls back to automatic routing. The old take
// dragged a divider inside a locked row, which never demonstrated the binding at
// all.
//
// Path: pointer starts outside the gallery on the right → into C (hover) →
// C's "向后合并" → the pointer now sits over B, whose row was just bound by the
// merge → hover B's link (bound state) → click to release → F's link → click to
// release → the pictures re-pack → pointer back outside.
import { join } from "node:path";
import { prepare, restore, hover, sleep, pageEval, dragScreen, screenOf, frameRegion, movePointer, motionPath, CACHE, encodeMp4, loopCloses, LANG } from "../lib/scene.mjs";
import { startGdigrab } from "../record.mjs";
import { spawnSync } from "node:child_process";

const ctx = await prepare({ note: "06-画廊手柄.md", mode: "source" });
await pageEval(`
  const sc = document.querySelector(".cm-scroller");
  if (sc) sc.scrollTop = 0;
  await new Promise((r) => setTimeout(r, 420));
  return true;
`);
await sleep(300);

const PARK = { x: 1100, y: 320 };
const park = screenOf(ctx.calib, PARK);

// Resolve one control by predicate inside the page, in CSS coordinates.
const boxOf = (expr) => pageEval(`
  const el = (${expr})();
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
`);
const cellOf = (alt) => boxOf(`() => [...document.querySelectorAll(".image-embed")]
  .find((el) => (el.querySelector("img")?.alt || "").startsWith(${JSON.stringify(alt)}))`);
const mergeLabel = LANG === "en" ? "Merge into the row below" : "向后合并";
const mergeOfLastCell = () => boxOf(`() => [...document.querySelectorAll(".ag-gallery-order-button")]
  .find((b) => b.getAttribute("aria-label") === ${JSON.stringify(mergeLabel)})`);
const linkOf = (alt) => boxOf(`() => {
  const embed = [...document.querySelectorAll(".image-embed")]
    .find((el) => (el.querySelector("img")?.alt || "").startsWith(${JSON.stringify(alt)}));
  return embed ? embed.querySelector(".ag-gallery-link") : null;
}`);
const linkState = (alt) => pageEval(`
  const embed = [...document.querySelectorAll(".image-embed")]
    .find((el) => (el.querySelector("img")?.alt || "").startsWith(${JSON.stringify(alt)}));
  const link = embed ? embed.querySelector(".ag-gallery-link") : null;
  return link ? link.className.replace("ag-gallery-link", "").trim() || "free" : null;
`);

const moveTo = async (p, speed = 5) => { await movePointer(p.x, p.y, speed); await sleep(320); };
const clickAt = async (p) => { await dragScreen(p, p, { holdMs: 60, dwellMs: 160 }); await sleep(520); };
const toScreen = (p) => screenOf(ctx.calib, p);
// Park on the cell, let the row light up, and only then step onto the link.
const hoverCell = async (alt) => {
  const c = await cellOf(alt);
  if (!c) throw new Error(`找不到 ${alt}`);
  await moveTo(toScreen(c), 5);
  await sleep(520);
};

// Park outside the gallery before the reveal, so the first frame has no hover.
// Native tooltips come from `title` attributes and are painted by the OS, so no
// page CSS can hide them. The handle controls are rebuilt after every layout
// change, which is why this runs again before each hover.
const muteTitles = () => pageEval(`
  document.querySelectorAll(".ag-gallery-order-button, .ag-gallery-link, .ag-gallery-divider, .ag-gallery-height")
    .forEach((el) => el.removeAttribute("title"));
  return true;
`);

// Park outside and let the hover fade before the recorder starts: the first
// frame must show the untouched row, otherwise the clip opens on C's handles and
// the loop has no clean frame to return to.
await movePointer(park.x, park.y, 6);
await sleep(700);

// The reveal is part of the clip, so it is driven inside the recording. The
// merge control is resolved after the hover starts, not before.
const c = await cellOf("C");
if (!c) throw new Error("找不到 C");

// Rows 1-2 across both layouts: 480 covers the merged block (row 2 ends at 660)
// and stops before the table heading, which moves to 716 in that state.
const region = frameRegion(ctx, { x: 208, y: 188, w: 784, h: 480 });

const raw = join(CACHE, "AG-V07-01-raw.mp4");
const out = motionPath("AG-V07-01", "mp4");
const marks = {};
const t0 = Date.now();
const mark = (n) => { marks[n] = +((Date.now() - t0) / 1000).toFixed(2); };

const rec = startGdigrab({ win: ctx.win, file: raw, seconds: 15, fps: 30 });
await sleep(500);
mark("start");
await sleep(320);

// 1. Into C — the row reveals its handles.
await moveTo(toScreen(c), 4);
await sleep(420);
const merge = await mergeOfLastCell();
if (!merge) throw new Error("C 的向后合并按钮未出现");
await moveTo(toScreen(merge), 4);
await sleep(200);
await clickAt(toScreen(merge));
await sleep(620);

// The bound state is shown by hovering the cell, not the link: resting on the
// link long enough to read it also triggers the native tooltip, which is painted
// by the OS outside the page and lands clipped at the frame edge.
const bState = await linkState("B");
await muteTitles();
await hoverCell("B");
const bLink = await linkOf("B");
await clickAt(toScreen(bLink));
await sleep(560);

await muteTitles();
await hoverCell("F");
const fLink = await linkOf("F");
await clickAt(toScreen(fLink));
await sleep(640);

await moveTo(park, 4);
// The hover has to fade before the last frame, or the loop closes on a lit row.
await sleep(560);
mark("end");
await rec.done;

const from0 = Math.max(0, marks.start - 0.05);
const to0 = Math.min(marks.end + 0.14, 15);
const trimmed = join(CACHE, "AG-V07-01-loop.mp4");
spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from0), "-to", String(to0), "-i", raw,
  "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", trimmed], { windowsHide: true });
encodeMp4(trimmed, out, { fps: 30, region, width: 1200 });
await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({ bState, region, marks, closes: loopCloses(out), out, size: statSync(out).size }, null, 1));
