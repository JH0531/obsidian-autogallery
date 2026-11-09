// AG-A20-01 — 设置页目录：点「画廊」跳到分区，再点「基础」回到顶部（循环）。
//
// The settings dialog is its own top-level window and does not report a screen
// position, so it is recorded through the window surface (WGC). There is no
// pointer in frame; what the clip shows is the nav highlight and the pane
// travelling, which is the point of the shot.
//
// Both ends are asserted, not assumed: the pane is driven to the top and polled
// until it stays there before recording, and each click waits until the target
// section is actually in view. The first take relied on sleeps and started
// mid-page, because the settings tab restores its own scroll offset on show.
import { join } from "node:path";
import { prepare, restore, sleep, pageEval, motionPath, CACHE, loopCloses, settingsTarget, windowByTitle } from "../lib/scene.mjs";
import { evalAt } from "../cdp.mjs";
import { startWinappRecord } from "../record.mjs";
import { spawnSync } from "node:child_process";

const ctx = await prepare({ note: "19-设置页.md", mode: "source" });
await pageEval(`app.setting.open(); app.setting.openTabById("obsidian-autogallery"); return true;`);
await sleep(1600);

const target = await settingsTarget();
const win = await windowByTitle("设置|Settings");

const settleTop = async () => {
  for (let i = 0; i < 30; i++) {
    const top = await evalAt(target, `
      const sc = document.querySelector(".vertical-tab-content");
      if (!sc) return null;
      sc.scrollTop = 0;
      await new Promise((r) => setTimeout(r, 120));
      return Math.round(sc.scrollTop);
    `);
    if (top === 0) {
      await sleep(320);
      const again = await evalAt(target, `const sc=document.querySelector(".vertical-tab-content"); return sc ? Math.round(sc.scrollTop) : null;`);
      if (again === 0) return true;
    }
  }
  return false;
};
if (!(await settleTop())) throw new Error("设置页未能停在顶部");

const clickNav = (label) => evalAt(target, `
  const item = [...document.querySelectorAll(".ag-nav-item")].find((el) => el.textContent.trim() === ${JSON.stringify(label)});
  if (!item) return false;
  item.click();
  return true;
`);
const sectionInView = (id) => evalAt(target, `
  const head = document.getElementById(${JSON.stringify(id)});
  if (!head) return false;
  const r = head.getBoundingClientRect();
  return r.top > -40 && r.top < innerHeight * 0.6;
`);
const waitFor = async (fn, ms = 2600) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await sleep(120);
  }
  return false;
};

const raw = join(CACHE, "AG-A20-01-raw.mp4");
const out = motionPath("AG-A20-01", "mp4");
const marks = {};
const t0 = Date.now();
const mark = (n) => { marks[n] = +((Date.now() - t0) / 1000).toFixed(2); };

const rec = startWinappRecord({ hwnd: win.hwnd, file: raw, seconds: 9, fps: 30, screen: false });
await sleep(900);
mark("start");
await sleep(520);

await clickNav("画廊");
const jumped = await waitFor(() => sectionInView("ag-sec-gallery"));
await sleep(700);

await clickNav("基础");
const back = await waitFor(() => evalAt(target, `const sc=document.querySelector(".vertical-tab-content"); return sc ? Math.round(sc.scrollTop) < 8 : false;`));
await sleep(760);
mark("end");
await rec.done;

// Start from the settled top, not from the first mark: the recorder needs a
// moment before its first frame lands, and trimming on the mark cut the opening
// beat (the first take began mid-jump).
const from0 = 0.25;
const to0 = Math.min(marks.end + 0.25, 9);
spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from0), "-to", String(to0), "-i", raw,
  "-vf", "scale=1200:-2:flags=lanczos",
  "-c:v", "libx264", "-preset", "slower", "-crf", "23", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart", "-an", out], { windowsHide: true });

await evalAt(target, `app.setting.close(); return true;`).catch(() => {});
await sleep(400);
await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({ jumped, back, marks, closes: loopCloses(out), out, size: statSync(out).size }, null, 1));
