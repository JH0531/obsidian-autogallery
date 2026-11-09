// AG-A20-02 — 目录搜索全流程：开框、输入、回车定位、下一个匹配、清空、收起、回顶。
//
// Replaces the still that used to show the counter (AG-S20-02). A number in a
// screenshot could not show that Enter jumps and the arrows walk the matches, so
// the flow is a clip.
//
// The settings window is recorded through its own surface (no pointer in frame);
// the text goes in through execCommand so it produces a real input event, which
// is what the counter listens to. CJK cannot be typed through injected keys
// without an IME.
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

// The settings tab keeps its state between runs: reset the pane, the field and
// the panel before recording, or the clip opens on the previous query.
const reset = () => evalAt(target, `
  const sc = document.querySelector(".vertical-tab-content");
  if (sc) sc.scrollTop = 0;
  const input = document.querySelector(".ag-setting-search-input");
  if (input) { input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true })); }
  const panel = document.querySelector(".ag-setting-search");
  const toggle = document.querySelector(".ag-nav-search");
  if (panel?.classList.contains("is-open") && toggle) toggle.click();
  return true;
`);
await reset();
await sleep(900);
await reset();
await sleep(600);

const readState = () => evalAt(target, `
  const count = document.querySelector(".ag-setting-search-count");
  const panel = document.querySelector(".ag-setting-search");
  const input = document.querySelector(".ag-setting-search-input");
  return {
    open: panel ? panel.classList.contains("is-open") : null,
    query: input ? input.value : null,
    counter: count ? count.textContent.trim() : null,
    scrollTop: Math.round(document.querySelector(".vertical-tab-content")?.scrollTop ?? -1)
  };
`);

const typeQuery = (text) => evalAt(target, `
  const input = document.querySelector(".ag-setting-search-input");
  if (!input) return false;
  input.focus();
  document.execCommand("insertText", false, ${JSON.stringify(text)});
  return true;
`);
const pressEnter = () => evalAt(target, `
  const input = document.querySelector(".ag-setting-search-input");
  if (!input) return false;
  input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  return true;
`);
const clickNext = () => evalAt(target, `
  const btn = document.querySelector('.ag-setting-search-button[aria-label="下一个匹配"]');
  if (!btn) return false;
  btn.click();
  return true;
`);
const clearQuery = () => evalAt(target, `
  const input = document.querySelector(".ag-setting-search-input");
  if (!input) return false;
  input.focus();
  input.select();
  document.execCommand("delete");
  return true;
`);
const closePanel = () => evalAt(target, `
  const toggle = document.querySelector(".ag-nav-search");
  if (!toggle) return false;
  toggle.click();
  return true;
`);

const raw = join(CACHE, "AG-A20-02-raw.mp4");
const out = motionPath("AG-A20-02", "mp4");
const rec = startWinappRecord({ hwnd: win.hwnd, file: raw, seconds: 14, fps: 30, screen: false });
await sleep(900);

// Each step is spaced so the change it causes is readable before the next one.
await sleep(700);
await evalAt(target, `document.querySelector(".ag-nav-search")?.click(); return true;`);
await sleep(900);
await typeQuery("间距");
await sleep(900);
await pressEnter();
await sleep(1500);
await clickNext();
await sleep(1400);
await clearQuery();
await sleep(900);
await closePanel();
await sleep(900);
await evalAt(target, `
  const sc = document.querySelector(".vertical-tab-content");
  if (sc) sc.scrollTo({ top: 0, behavior: "smooth" });
  return true;
`);
await sleep(1200);
// The smooth scroll settles a pixel or two short; the loop has to end on the
// exact frame it started from.
await evalAt(target, `const sc=document.querySelector(".vertical-tab-content"); if(sc) sc.scrollTop=0; return true;`);
await sleep(700);
const state = await readState();
await rec.done;

spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", "0.25", "-to", "12.6", "-i", raw,
  "-vf", "scale=1200:-2:flags=lanczos",
  "-c:v", "libx264", "-preset", "slower", "-crf", "23", "-pix_fmt", "yuv420p",
  "-movflags", "+faststart", "-an", out], { windowsHide: true });

await evalAt(target, `app.setting.close(); return true;`).catch(() => {});
await sleep(400);
await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({ state, closes: loopCloses(out), out, size: statSync(out).size }, null, 1));
