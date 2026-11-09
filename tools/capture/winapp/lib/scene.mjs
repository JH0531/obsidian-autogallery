// Shared scene scaffolding.
//
// Every interaction shot follows the same shape: stage the window, open a note,
// hide the chrome, calibrate, record a loop, encode, restore. Only the middle
// part differs, so it lives here and each scene stays about the action itself.
//
// "Loop" is the house style for gesture shots: do the thing, hold 300ms, undo it,
// hold 300ms. The clip then starts and ends on the same geometry, so the APNG
// loops without a jump and there is no dead tail.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { pageEval } from "../cdp.mjs";
import { calibrate } from "../calibrate.mjs";
import { targetWindow } from "../window.mjs";
import { movePointer, focusWindow, clickCss, doubleClickCss, dragCss, sendKeys } from "../ui.mjs";
import { startGdigrab, grabFrame as grabFrameLocal } from "../record.mjs";
import { CACHE, VAULT } from "../env.mjs";
import { stillRel, motionRel, assertContentLang } from "../../lib/media.mjs";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Which cell of the language × theme matrix this process is capturing. The
// caller (run-ui.mjs, or shoot-batch for content stills) sets the environment;
// the defaults are the primary cell, zh / dark.
export const LANG = process.env.AG_LANG === "en" ? "en" : "zh";

// Scenes name the note they drive in Chinese. In the English vault the same
// chapter has the same numeric prefix, so map by prefix instead of duplicating
// every scene.
function notePathFor(note) {
  if (LANG !== "en" || !/^\d{2}-/.test(note)) return note;
  const prefix = note.slice(0, 2);
  try {
    return readdirSync(VAULT).find((name) => name.startsWith(`${prefix}-`) && name.endsWith(".md")) ?? note;
  } catch {
    return note;
  }
}
export const THEME = process.env.AG_THEME === "light" ? "light" : "dark";

const STYLE = ".tooltip{display:none!important}"
  + ".workspace-split.mod-left-split,.workspace-split.mod-right-split,.workspace-ribbon{display:none!important}"
  + ".cm-gutters{display:none!important}"
  + ".cm-scroller{scrollbar-width:none}.cm-scroller::-webkit-scrollbar{display:none!important}";

export async function prepare({ note, mode = "source", anchor = null, offsetTop = 200, extraCss = "", calibrate: doCalibrate = true, background = false }) {
  const notePath = notePathFor(note);
  await pageEval(`
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const ew = window.electronWindow;
    const background = ${JSON.stringify(Boolean(background))};
    if (!background) {
      try { ew.setAlwaysOnTop?.(true, "screen-saver"); ew.moveTop?.(); } catch {}
      try { (ew.setZoomFactor ?? ew.webContents?.setZoomFactor)?.call(ew.webContents ?? ew, 1); } catch {}
      try { ew.setContentSize?.(1200, 800); } catch {}
      try { ew.show?.(); ew.focus?.(); } catch {}
      await sleep(250);
    }
    window.dispatchEvent(new Event("resize"));
    try { app.workspace.layout?.(); } catch {}

    const file = app.vault.getAbstractFileByPath(${JSON.stringify(notePath)});
    if (!file) return { error: "missing note" };
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
    const st = leaf.getViewState();
    st.state = st.state || {};
    st.state.mode = ${JSON.stringify(mode)};
    await leaf.setViewState(st);
    await sleep(700);

    document.body.classList.add("ag-recording");
    let style = document.getElementById("ag-scene-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "ag-scene-style";
      document.head.appendChild(style);
    }
    style.textContent = ${JSON.stringify(STYLE + extraCss)};

    try { app.workspace.leftSplit?.collapse?.(); } catch {}
    try { app.workspace.rightSplit?.collapse?.(); } catch {}
    await sleep(450);

    const anchor = ${JSON.stringify(anchor)};
    if (anchor) {
      const heading = [...leaf.view.containerEl.querySelectorAll(".HyperMD-header, [class*='el-h'], h1, h2, h3")]
        .find((el) => el.textContent.trim().includes(anchor));
      const scroller = leaf.view.containerEl.querySelector(".cm-scroller");
      if (heading && scroller) {
        scroller.scrollTop += heading.getBoundingClientRect().top - ${offsetTop};
      }
    }
    await sleep(500);
    return { ok: true };
  `);

  if (!background) {
    await focusWindow();
    await sleep(250);
  }
  const calib = doCalibrate ? await calibrate({ quiet: true }) : null;
  const win = doCalibrate ? await targetWindow() : null;
  const original = await pageEval(`return await app.vault.adapter.read(${JSON.stringify(notePath)});`);
  return { calib, win, note: notePath, original };
}

export function screenOf(calib, css) {
  return {
    x: Math.round(calib.origin.screen.x + css.x * calib.scale.x),
    y: Math.round(calib.origin.screen.y + css.y * calib.scale.y)
  };
}

export async function centerOf(selector) {
  const r = await pageEval(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    // Only scroll when the element is actually out of view. Re-centring on every
    // call made the picture jump mid-take: a scene hovers once to aim, records,
    // hovers again, and the second hover scrolled the note under the camera.
    const first = el.getBoundingClientRect();
    if (first.top < 8 || first.bottom > innerHeight - 8) {
      el.scrollIntoView({ block: "center" });
      await new Promise((x) => requestAnimationFrame(() => requestAnimationFrame(x)));
      await new Promise((x) => setTimeout(x, 120));
    }
    const b = el.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2, w: b.width, h: b.height };
  `);
  return r;
}

export async function hover(calib, selector, { dx = 0, dy = 0, speed = 6 } = {}) {
  const c = await centerOf(selector);
  if (!c) throw new Error(`找不到 ${selector}`);
  const p = screenOf(calib, { x: c.x + dx, y: c.y + dy });
  await movePointer(p.x, p.y, speed);
  return p;
}

// Drag between two points already in screen space. The selector-based helper
// re-resolves the element and re-tests the hit on every call, which costs about
// a second — too much when a loop only has 300ms of headroom.
export async function dragScreen(from, to, { holdMs = 120, dwellMs = 260 } = {}) {
  const { runWinapp } = await import("../winapp.mjs");
  const { targetWindow } = await import("../window.mjs");
  const win = await targetWindow();
  const args = ["ui", "drag", `${from.x},${from.y}`, `${to.x},${to.y}`,
    "--hold-ms", String(holdMs), "--dwell-ms", String(dwellMs), "-w", String(win.hwnd), "--json"];
  const r = await runWinapp(args, { timeoutMs: 20000 });
  return { ok: r.ok, code: r.code, message: r.message };
}

export function record(raw, seconds) {
  return startGdigrab({ win: raw.win, file: raw.file, seconds, fps: 30 });
}

// A window take is cropped symmetrically by 15 physical px to drop the edge
// pixels, then scaled to the delivery size.
const EDGE_CROP = "crop=in_w-30:in_h:15:0";

// libx264 and the APNG encoder both reject odd dimensions.
const even = (n) => n & ~1;

// A CSS rectangle as a crop of the raw gdigrab frame.
//
// The frame starts at the top-left corner of the window, while the calibration
// is in screen space, so one is subtracted from the other. Scenes that frame a
// single band (a gallery row, a dialog) use this instead of shipping the whole
// window with three quarters of it empty.
export function frameRegion(ctx, css, { pad = 0 } = {}) {
  const { calib, win } = ctx;
  const x = Math.round(calib.origin.screen.x + (css.x - pad) * calib.scale.x) - win.x;
  const y = Math.round(calib.origin.screen.y + (css.y - pad) * calib.scale.y) - win.y;
  return {
    x: Math.max(0, even(x)),
    y: Math.max(0, even(y)),
    w: even(Math.round((css.w + pad * 2) * calib.scale.x)),
    h: even(Math.round((css.h + pad * 2) * calib.scale.y))
  };
}

function run(args) {
  const r = spawnSync("ffmpeg", args, { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg 失败: ${String(r.stderr).slice(-300)}`);
  return r;
}

// Motion deliverables are MP4. The site plays them in a <video loop>, so an
// APNG's only advantage -- playing without controls -- buys nothing, while its
// per-frame palette costs several megabytes on photographic content. CRF 23 on
// flat UI keeps a 3s 1200x800 clip around 150-300 KB.
export function encodeMp4(rawFile, out, { fps = 30, crf = 23, region = null, width = 1200 } = {}) {
  // With a region the clip keeps its own aspect ratio; only the window-wide
  // default is forced to 1200x800, because that is the size the stage was set to.
  // A different width means the caller wants a smaller frame (a long comparison
  // take), and then the height follows the source instead of being squashed.
  const vf = region
    ? `crop=${region.w}:${region.h}:${region.x}:${region.y},scale=${even(width)}:-2:flags=lanczos,fps=${fps}`
    : width === 1200
      ? `${EDGE_CROP},scale=1200:800:flags=lanczos,fps=${fps}`
      : `${EDGE_CROP},scale=${even(width)}:-2:flags=lanczos,fps=${fps}`;
  run(["-v", "error", "-y", "-i", rawFile, "-vf", vf,
    "-c:v", "libx264", "-preset", "slower", "-crf", String(crf), "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-an", out]);
  return out;
}

// APNG for loops: palette of 192 colours keeps a 3-second 1200x800 take well
// under the 8 MB ceiling while staying clean on flat UI colours.
export function encodeApng(rawFile, out, { fps = 10, colors = 160, region = null, width = 1200 } = {}) {
  const palette = join(CACHE, "palette.png");
  const vf = region
    ? `crop=${region.w}:${region.h}:${region.x}:${region.y},scale=${even(width)}:-2:flags=lanczos,fps=${fps}`
    : `${EDGE_CROP},scale=1200:800:flags=lanczos,fps=${fps}`;
  run(["-v", "error", "-y", "-i", rawFile, "-vf", `${vf},palettegen=max_colors=${colors}:stats_mode=diff`, palette]);
  run(["-v", "error", "-y", "-i", rawFile, "-i", palette, "-lavfi", `${vf}[x];[x][1:v]paletteuse=dither=sierra2_4a`,
    "-plays", "0", "-f", "apng", out]);
  return out;
}

export function strip(rawFile, out, { from, to, fps = 30 }) {
  run(["-v", "error", "-y", "-ss", String(from), "-to", String(to), "-i", rawFile, "-vf",
    `${EDGE_CROP},scale=1200:800:flags=lanczos,fps=${fps}`,
    "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-an", out]);
  return out;
}

export async function restore(ctx) {
  // Preserve anything changed outside the scene before the original is written
  // back: a manual edit made while a recording runs would otherwise be lost.
  const currentNote = await pageEval(`
    const note = ${JSON.stringify(ctx.note)};
    const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.file?.path === note);
    return leaf?.view?.editor ? leaf.view.editor.getValue() : await app.vault.adapter.read(note);
  `).catch(() => null);
  if (currentNote && currentNote !== ctx.original) {
    const dir = join(CACHE, "restore");
    mkdirSync(dir, { recursive: true });
    const backup = join(dir, `${Date.now()}-${basename(ctx.note)}`);
    writeFileSync(backup, currentNote, "utf8");
    console.warn(`[restore] 笔记在场景外被修改，已备份：${backup}`);
  }
  // Writing the file is not enough: the note is open in an editor that holds its
  // own buffer, and Obsidian saves that buffer back over the file a moment later.
  // A probe that only touched the disk left the note carrying `ag:group` ids from
  // a merge, which then poisoned every later take that assumed a clean note.
  await pageEval(`
    const note = ${JSON.stringify(ctx.note)};
    const original = ${JSON.stringify(ctx.original)};
    const leaf = app.workspace.getLeavesOfType("markdown").find((l) => l.view?.file?.path === note);
    const editor = leaf?.view?.editor;
    if (editor && editor.getValue() !== original) editor.setValue(original);
    await app.vault.adapter.write(note, original);
    return true;
  `).catch(() => {});
  await pageEval(`
    document.body.classList.remove("ag-recording");
    try { app.workspace.leftSplit?.expand?.(); } catch {}
    try { app.workspace.rightSplit?.expand?.(); } catch {}
    return true;
  `).catch(() => {});
}

// Delivery paths carry the cell, not the file name: media/<lang>/<theme>/<kind>/.
// A scene therefore never spells the language into an id, and a content frame
// cannot land under en/ without an English note.
export const motionPath = (id, ext) => {
  assertContentLang(id, LANG);
  return join(VAULT, motionRel(id, LANG, THEME, ext));
};
export const stillPath = (id) => {
  assertContentLang(id, LANG);
  return join(VAULT, stillRel(id, LANG, THEME));
};

// Stills are delivered as WebP. A scene that composes its frame with ffmpeg
// hands the PNG over here instead of writing it straight to the delivery path.
export function encodeStill(png, out, { quality = 85 } = {}) {
  if (!/\.webp$/i.test(out)) throw new Error(`静帧必须输出 webp：${out}`);
  mkdirSync(dirname(out), { recursive: true });
  const r = spawnSync("magick", [png, "-strip", "-quality", String(quality), "-define", "webp:method=6", out], {
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024
  });
  if (r.status !== 0) throw new Error(`webp 编码失败: ${String(r.stderr).slice(-200)}`);
  return out;
}

export function bytes(file) {
  return readFileSync(file).length;
}

export { pageEval, clickCss, doubleClickCss, dragCss, movePointer, focusWindow, sendKeys, CACHE, VAULT };

// One still of the whole window, edge-cropped and scaled to the 1500px still
// width. Content stills that frame a section keep using shoot.js; this is for
// interface shots where the point is the window itself.
export function shotWindow(win, out) {
  const full = join(CACHE, `shot-${Date.now()}.png`);
  const png = join(CACHE, `shot-${Date.now()}-1500.png`);
  grabFrameLocal({ win, file: full });
  run(["-v", "error", "-y", "-i", full, "-vf", `${EDGE_CROP},scale=1500:-2:flags=lanczos`, png]);
  return encodeStill(png, out);
}

// Crop a still to one element. UI shots are unreadable when a 600px palette is
// scaled down to fit a 1500px window frame, so the element itself is the frame.
export async function shotElement(ctx, selector, out, { pad = 16, width = 1500 } = {}) {
  const rect = await pageEval(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  `);
  if (!rect) throw new Error(`找不到 ${selector}`);
  const { calib } = ctx;
  const x = Math.round(calib.origin.image.x + (rect.x - pad) * calib.scale.x);
  const y = Math.round(calib.origin.image.y + (rect.y - pad) * calib.scale.y);
  const w = Math.round((rect.w + pad * 2) * calib.scale.x);
  const h = Math.round((rect.h + pad * 2) * calib.scale.y);
  // Window-level capture, not the screen DC: WGC returns the target window only,
  // so other processes' always-on-top overlays never land in a UI still. The
  // calibration was measured on this same channel, so the crop lines up exactly.
  const full = join(CACHE, `elem-${Date.now()}.png`);
  await (await import("../winapp.mjs")).runWinapp(
    ["ui", "screenshot", "-w", String(ctx.win.hwnd), "-o", full, "--json"], { timeoutMs: 30000 });
  const png = join(CACHE, `elem-${Date.now()}-${width}.png`);
  run(["-v", "error", "-y", "-i", full, "-vf", `crop=${w}:${h}:${x}:${y},scale=${width}:-2:flags=lanczos`, png]);
  return encodeStill(png, out);
}

// A loop only earns the word if it ends where it began.
//
// Byte equality was the old test and it fails on photographic content for a
// reason that has nothing to do with the loop: the first frame is an I-frame and
// the last is a P-frame, so x264 leaves different noise on each. A take whose
// geometry returned exactly still reported "does not close".
//
// So the check is the mean difference over the frame, with byte equality kept as
// the fast path. A real geometry jump (a column moving 150px) scores several
// percent; codec noise on a photo scores well under one.
export function loopCloses(file, { tolerance = 0.01 } = {}) {
  const a = join(CACHE, "loop-a.png");
  const b = join(CACHE, "loop-b.png");
  spawnSync("ffmpeg", ["-v", "error", "-y", "-i", file, "-frames:v", "1", a], { windowsHide: true });
  spawnSync("ffmpeg", ["-v", "error", "-y", "-sseof", "-0.12", "-i", file, "-frames:v", "1", b], { windowsHide: true });
  try {
    if (readFileSync(a).equals(readFileSync(b))) return { exact: true, mean: 0, pass: true };
    const probe = spawnSync("magick", [a, b, "-compose", "difference", "-composite", "-format", "%[fx:mean]", "info:"],
      { encoding: "utf8", windowsHide: true });
    const mean = Number(String(probe.stdout || "").trim());
    return { exact: false, mean: Number.isFinite(mean) ? Number(mean.toFixed(5)) : null, pass: Number.isFinite(mean) && mean <= tolerance };
  } catch {
    return { exact: false, mean: null, pass: false };
  }
}

// Click by visible text inside a container. Buttons in these dialogs have no
// stable id, and the label is the only thing the reader uses too.
export async function clickText(ctx, container, text) {
  const rect = await pageEval(`
    const root = document.querySelector(${JSON.stringify(container)});
    if (!root) return null;
    const wanted = ${JSON.stringify(text)};
    const el = [...root.querySelectorAll("button, .clickable-icon, [role='button']")]
      .find((b) => (b.textContent || "").trim() === wanted);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  `);
  if (!rect) throw new Error(`找不到文本按钮 ${text}`);
  const p = screenOf(ctx.calib, rect);
  await movePointer(p.x, p.y, 4);
  await sleep(120);
  const { runWinapp } = await import("../winapp.mjs");
  const r = await runWinapp(["ui", "drag", `${p.x},${p.y}`, `${p.x},${p.y}`,
    "-w", String(ctx.win.hwnd), "--json"], { timeoutMs: 20000 });
  return { ok: r.ok, code: r.code };
}

// Leave a modal the way a reader does: click the cancel button so Obsidian runs
// its own teardown, then click the active tab to hand focus back. Removing the
// modal node directly skips that teardown — the modal-container and its dim
// layer stay behind and the editor keeps looking inactive.
export async function closeModal(ctx, { container = ".modal-container", cancelText = "取消" } = {}) {
  let clicked = false;
  try {
    await clickText(ctx, container, cancelText);
    clicked = true;
  } catch {}
  await sleep(350);

  const leftover = await pageEval(`return document.querySelectorAll(".modal-container").length;`);
  if (leftover) {
    await pageEval(`
      document.querySelectorAll(".modal-container").forEach((e) => e.remove());
      document.body.classList.remove("modal-open", "is-modal-open");
      return true;
    `);
  }
  await sleep(150);

  // A normal close already hands focus back; the fallback path above is the only
  // case that leaves the editor dimmed, and clicking the tab fixes that one.
  if (leftover) {
    try {
      await clickCss(".workspace-tab-header.mod-active", { settle: 260 });
    } catch {}
    await sleep(200);
  }
  return { clicked, leftover: Boolean(leftover) };
}

// The settings dialog is its own window on this build, so it needs its own
// target and its own capture. Nothing here is a pointer gesture — the point is
// the panel's appearance — so the state is driven through the DOM.
export async function settingsTarget() {
  const { listPages } = await import("../cdp.mjs");
  const pages = await listPages();
  // The window title follows the interface language: 设置 / Settings.
  const page = pages.find((p) => /^(设置|Settings)/.test(p.title || ""));
  if (!page) throw new Error("设置窗口未打开");
  return page.webSocketDebuggerUrl;
}

export async function windowByTitle(titlePrefix) {
  const { runWinapp } = await import("../winapp.mjs");
  const list = await runWinapp(["ui", "list-windows", "-a", "Obsidian", "--json"]);
  const prefixes = titlePrefix.split("|");
  const win = (list.data || []).find((r) => prefixes.some((p) => (r.title || "").startsWith(p)));
  if (!win) throw new Error(`找不到窗口 ${titlePrefix}`);
  // list-windows reports size but not position; the screen grab needs both.
  const inspected = await runWinapp(["ui", "inspect", "-w", String(win.hwnd), "--depth", "2", "--json"]);
  const root = (inspected.data?.windows?.[0]?.elements || [])[0] || {};
  return { ...win, x: root.x, y: root.y, width: root.width ?? win.width, height: root.height ?? win.height };
}

export async function shotWindowByTitle(ctx, titlePrefix, out, width = 1500) {
  const { runWinapp } = await import("../winapp.mjs");
  const win = await windowByTitle(titlePrefix);
  const raw = join(CACHE, `win-${Date.now()}.png`);
  const shot = await runWinapp(["ui", "screenshot", "-w", String(win.hwnd), "-o", raw, "--json"]);
  if (!shot.ok) throw new Error(`窗口截图失败 ${shot.code || ""}`);
  const png = join(CACHE, `win-${Date.now()}-${width}.png`);
  run(["-v", "error", "-y", "-i", raw, "-vf", `scale=${width}:-2:flags=lanczos`, png]);
  return encodeStill(png, out);
}

// One region of a separate window, given in that window's CSS coordinates.
//
// The settings window reports no screen position, so it is captured by HWND;
// the image is at device pixels while the rect was measured in CSS, and the
// ratio between the two is read back from the capture itself. Element shots of
// the settings pane use this: a 900px panel scaled to a 1500px window frame is
// unreadable, and the region is the only part worth showing.
export async function shotWindowCss(ctx, { hwnd, rect, inner, out, pad = 14, width = 1500 }) {
  const { runWinapp } = await import("../winapp.mjs");
  const raw = join(CACHE, `win-${Date.now()}.png`);
  const shot = await runWinapp(["ui", "screenshot", "-w", String(hwnd), "-o", raw, "--json"]);
  if (!shot.ok) throw new Error(`窗口截图失败 ${shot.code || ""}`);
  const probe = spawnSync("ffprobe", [
    "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", raw
  ], { encoding: "utf8" });
  const [imageW] = String(probe.stdout || "").trim().split(",").map(Number);
  if (!imageW) throw new Error("读不出窗口截图尺寸");
  const scale = imageW / inner.w;
  const x = Math.round((rect.x - pad) * scale);
  const y = Math.round((rect.y - pad) * scale);
  const w = Math.round((rect.w + pad * 2) * scale);
  const h = Math.round((rect.h + pad * 2) * scale);
  const png = join(CACHE, `elem-${Date.now()}.png`);
  run(["-v", "error", "-y", "-i", raw, "-vf", `crop=${w}:${h}:${x}:${y},scale=${width}:-2:flags=lanczos`, png]);
  return encodeStill(png, out);
}

// The theme background, as a value ffmpeg's `pad` filter accepts. A composed
// still pads with this colour, so the frame belongs to whichever theme was
// captured instead of being hard-wired to the dark palette.
export async function pageBackground() {
  const rgb = await pageEval(`return getComputedStyle(document.body).backgroundColor;`);
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(String(rgb));
  if (!match) throw new Error(`读不到背景色：${rgb}`);
  const hex = match.slice(1, 4).map((v) => Number(v).toString(16).padStart(2, "0")).join("");
  return `0x${hex}`;
}

// Force-removing a modal node leaves the plugin's own modal bookkeeping behind
// (the PDF dialog keeps a session object), so the next open silently fails.
// Reloading the plugin is the cheap way back to a known state.
export async function reloadPlugin() {
  await pageEval(`
    await app.plugins.disablePlugin("obsidian-autogallery");
    await app.plugins.enablePlugin("obsidian-autogallery");
    return true;
  `);
  await sleep(1500);
}

// Theme switching goes through the shared snippet: the settings window is a
// separate CDP target, and repainting the wrong one silently changes nothing.
export { setTheme } from "../../lib/theme.mjs";

// UI stills are language specific: everything with interface text is captured
// once per locale. The directory says which; the file name does not.
export async function setLanguage(lang) {
  const current = await pageEval(`return window.localStorage.getItem("language") || "zh";`).catch(() => null);
  if (current === lang) return { changed: false, lang };
  await pageEval(`window.localStorage.setItem("language", ${JSON.stringify(lang)}); setTimeout(() => location.reload(), 60); return true;`);
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    try {
      const ok = await pageEval(`return typeof app !== "undefined" && !!document.querySelector(".workspace");`);
      if (ok) return { changed: true, lang };
    } catch {}
  }
  throw new Error(`切换语言到 ${lang} 超时`);
}
