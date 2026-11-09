// AG-V19-01 — 分页预览逐项开关：标题分页开/关，右侧分页视图重排并滚动对照。
import { join } from "node:path";
import { prepare, restore, sleep, pageEval, clickText, motionPath, CACHE, encodeMp4, loopCloses, reloadPlugin, LANG } from "../lib/scene.mjs";
import { setTheme } from "../../lib/theme.mjs";
import { startGdigrab } from "../record.mjs";
import { spawnSync } from "node:child_process";

const ctx = await prepare({ note: "18-PDF分页.md", mode: "source" });
await setTheme("dark");
await reloadPlugin();
await pageEval(`app.commands.executeCommandById("obsidian-autogallery:export-pdf"); return true;`);
for (let i = 0; i < 40; i += 1) {
  const ready = await pageEval(`const s=document.querySelector(".ag-pdf-export__sheet"); return !!(s && s.offsetHeight > 100);`);
  if (ready) break;
  await sleep(300);
}
await sleep(500);
await clickText(ctx, ".modal-container", LANG === "en" ? "Paginated preview" : "分页预览");
for (let i = 0; i < 80; i += 1) {
  const pages = await pageEval(`return document.querySelectorAll(".ag-pdf-export__page canvas").length;`);
  if (pages > 0) break;
  await sleep(250);
}
await sleep(600);

const headingLabel = LANG === "en" ? "Heading pagination" : "标题分页";
const toggleHeading = () => pageEval(`
  const row = [...document.querySelectorAll(".modal-container .setting-item")]
    .find((el) => el.textContent.includes(${JSON.stringify(headingLabel)}));
  const box = row?.querySelector(".checkbox-container");
  const input = row?.querySelector('input[type="checkbox"]');
  if (!box) return null;
  const before = Boolean(input?.checked);
  box.click();
  return { before };
`);

const waitPreview = async () => {
  for (let i = 0; i < 80; i += 1) {
    const state = await pageEval(`
      const status = document.querySelector(".ag-pdf-export__status")?.textContent || "";
      return { busy: /生成|Generating|准备|Preparing/.test(status), pages: document.querySelectorAll(".ag-pdf-export__page canvas").length };
    `);
    if (state.pages > 0 && !state.busy) return true;
    await sleep(250);
  }
  return false;
};

// The clip assumes heading pagination starts enabled, so a change is visible.
let state = await toggleHeading();
if (state && !state.before) {
  // The click enabled it; keep this state as the loop's starting point.
  await sleep(2400);
}
await waitPreview();
await sleep(600);

const scrollPreview = (to) => pageEval(`
  const holder = [...document.querySelectorAll(".ag-pdf-export__pages")].pop();
  let el = holder;
  while (el && el.scrollHeight <= el.clientHeight + 8) el = el.parentElement;
  if (!el) return false;
  const from = el.scrollTop;
  const end = ${JSON.stringify(to)};
  const target = end === "bottom" ? el.scrollHeight - el.clientHeight : Number(end);
  const t0 = performance.now();
  await new Promise((resolve) => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1400);
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      el.scrollTop = from + (target - from) * e;
      if (k < 1) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
  return true;
`);

await pageEval(`
  const holder = [...document.querySelectorAll(".ag-pdf-export__pages")].pop();
  let el = holder;
  while (el && el.scrollHeight <= el.clientHeight + 8) el = el.parentElement;
  if (el) el.scrollTop = 0;
  return true;
`);

const raw = join(CACHE, "AG-V19-01-raw.mp4");
const out = motionPath("AG-V19-01", "mp4");
const marks = {};
const t0 = Date.now();
const mark = (n) => { marks[n] = +((Date.now() - t0) / 1000).toFixed(2); };

const rec = startGdigrab({ win: ctx.win, file: raw, seconds: 24, fps: 30 });
await sleep(550);
mark("start");
await sleep(1200);

await toggleHeading();
await waitPreview();
await sleep(400);
await scrollPreview("bottom");
await sleep(500);

await toggleHeading();
await waitPreview();
await sleep(400);
await pageEval(`
  const holder = [...document.querySelectorAll(".ag-pdf-export__pages")].pop();
  let el = holder;
  while (el && el.scrollHeight <= el.clientHeight + 8) el = el.parentElement;
  if (el) el.scrollTop = 0;
  return true;
`);
await sleep(700);
mark("end");
await rec.done;

const from0 = Math.max(0, marks.start - 0.05);
const to0 = Math.min(marks.end + 0.15, 24);
const trimmed = join(CACHE, "AG-V19-01-loop.mp4");
spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from0), "-to", String(to0), "-i", raw,
  "-c:v", "libx264", "-crf", "16", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", trimmed], { windowsHide: true });
encodeMp4(trimmed, out, { fps: 30 });

await clickText(ctx, ".modal-container", LANG === "en" ? "Cancel" : "取消").catch(() => {});
await sleep(400);
await restore(ctx);
await setTheme("dark");

const { statSync } = await import("node:fs");
console.log(JSON.stringify({ marks, closes: loopCloses(out), out, size: statSync(out).size }, null, 1));
