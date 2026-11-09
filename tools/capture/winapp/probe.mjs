#!/usr/bin/env node
// Phase 0 capability matrix.
//
//   node tools/capture/winapp/probe.mjs [--json] [--only P0-03]
//
// Every check answers a question the plan depends on, and every one is measured
// against the running app rather than inferred from documentation: the shipped
// 0.7.1 CLI is older than the docs site, so assumptions about flags are wrong
// until proven.

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CACHE, STATE } from "./env.mjs";
import { pageEval } from "./cdp.mjs";
import { loadCalib, cssToScreen } from "./rect.mjs";
import { calibrate } from "./calibrate.mjs";
import { targetWindow } from "./window.mjs";
import { runWinapp } from "./winapp.mjs";
import { clickCss, movePointer, pointerPos, sendKeys, screenshot, pngSize, dragCss, focusWindow } from "./ui.mjs";
import { startGdigrab, startWinappRecord, extractFrame, countRed, countWhite, ffprobe } from "./record.mjs";

const PROBE_ID = "__ag_probe";
const results = [];
const t0 = Date.now();

function record(id, title, ok, detail, extra, { gate = true } = {}) {
  results.push({ id, title, ok, gate, detail, ...(extra ? { extra } : {}) });
  if (!globalThis.__QUIET__) {
    process.stderr.write(`${ok ? "PASS" : "FAIL"}${gate ? "" : " (info)"}  ${id}  ${title}  ${detail}\n`);
  }
}

const MARKER = { css: { x: 600, y: 320 }, w: 80, h: 80 };

async function installFixture() {
  return pageEval(`
    const old = document.getElementById("${PROBE_ID}");
    if (old) old.remove();
    const s = { clicks: 0, downs: 0, ups: 0, moves: 0, enter: 0, downAt: null, upAt: null };
    globalThis.__ag_probe = s;
    const d = document.createElement("div");
    d.id = "${PROBE_ID}";
    d.style.cssText = "position:fixed;left:" + (${MARKER.css.x} - ${MARKER.w} / 2) + "px;top:" + (${MARKER.css.y} - ${MARKER.h} / 2) + "px;width:${MARKER.w}px;height:${MARKER.h}px;z-index:2147483646;background:#1d2b36;border-radius:8px;transition:background 120ms linear;";
    d.addEventListener("click", () => { s.clicks++; });
    d.addEventListener("pointerdown", (e) => { s.downs++; s.downAt = [e.clientX, e.clientY]; try { d.setPointerCapture(e.pointerId); } catch {} });
    d.addEventListener("pointerup", (e) => { s.ups++; s.upAt = [e.clientX, e.clientY]; try { d.releasePointerCapture(e.pointerId); } catch {} });
    d.addEventListener("pointermove", () => { s.moves++; });
    d.addEventListener("mouseenter", () => { s.enter++; });
    document.body.appendChild(d);
    const r = d.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  `);
}

const removeFixture = () => pageEval(`
  const d = document.getElementById("${PROBE_ID}");
  if (d) d.remove();
  return true;
`);

const probeState = () => pageEval(`return globalThis.__ag_probe || null;`);

async function main() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(STATE, { recursive: true });

  // Injected input lands on the foreground window. Every input verb in winapp
  // needs the target activated first; without this the calls report success and
  // nothing happens, which is the worst possible failure mode.
  const focused = await focusWindow();
  await new Promise((r) => setTimeout(r, 400));
  const fg = await runWinapp(["ui", "list-windows", "-a", "Obsidian", "--json"], { timeoutMs: 15000 });
  const fgRow = (Array.isArray(fg.data) ? fg.data : []).find((r) => r.ownerHwnd === 0);
  record("P0-00", "窗口已置前", !!(fgRow && fgRow.isForeground), `isForeground=${fgRow && fgRow.isForeground} ahk=${focused.ok}`);

  // P0-01 window targeting
  const a = await targetWindow({ refresh: true });
  const b = await targetWindow({ refresh: true });
  record("P0-01", "窗口定向", a.ok && a.hwnd === b.hwnd,
    a.ok ? `HWND ${a.hwnd} ${a.width}x${a.height} @${a.x},${a.y} scale ${a.scale}` : `失败: ${a.message}`,
    { hwnd: a.hwnd, box: { x: a.x, y: a.y, w: a.width, h: a.height } });

  // P0-02 capability surface actually shipped
  const schema = (await runWinapp(["ui", "--cli-schema"], { timeoutMs: 20000 })).data || {};
  const clickOpts = Object.keys(schema?.subcommands?.click?.options || {});
  record("P0-02", "--at 坐标入口", clickOpts.includes("--at"),
    clickOpts.includes("--at") ? "click 支持 --at" : "0.7.1 无 --at：hover 走 AHK，click 走 drag 同点",
    { clickOpts }, { gate: false });

  // P0-03 calibration + click delivery
  const calib = await calibrate({ quiet: true });
  record("P0-03a", "标定残差", calib.ok && calib.residualPx <= 1.5,
    `scale ${calib.scale?.x}/${calib.scale?.y} 屏幕原点 ${calib.origin?.screen?.x},${calib.origin?.screen?.y} 残差 ${calib.residualPx}px`);

  await installFixture();
  await movePointer(calib.origin.screen.x + 900 * calib.scale.x, calib.origin.screen.y + 600 * calib.scale.y);
  await new Promise((r) => setTimeout(r, 200));

  let hits = 0;
  for (let i = 0; i < 10; i++) {
    const res = await clickCss(`#${PROBE_ID}`, { settle: 90 });
    if (res.ok) hits++;
  }
  const afterClicks = await probeState();
  record("P0-03b", "坐标点击 10 次", afterClicks.clicks === 10,
    `clicks=${afterClicks.clicks} downs=${afterClicks.downs} ups=${afterClicks.ups}（注入命令成功 ${hits}/10）`);

  // P0-04 hover without pressing
  await movePointer(calib.origin.screen.x + 900 * calib.scale.x, calib.origin.screen.y + 600 * calib.scale.y);
  await new Promise((r) => setTimeout(r, 200));
  const beforeEnter = (await probeState()).enter;
  await movePointer(...Object.values(cssToScreen(calib, MARKER.css.x, MARKER.css.y)));
  await new Promise((r) => setTimeout(r, 400));
  const hover = await pageEval(`
    const d = document.getElementById("${PROBE_ID}");
    return {
      hovered: d.matches(":hover"),
      bg: getComputedStyle(d).backgroundColor,
      enter: globalThis.__ag_probe.enter,
      downsAfterHover: globalThis.__ag_probe.downs
    };
  `);
  record("P0-04", "悬停不点击", hover.hovered === true && hover.downsAfterHover === 10,
    `:hover=${hover.hovered} mouseenter=${hover.enter - beforeEnter} 未产生额外按下（downs ${hover.downsAfterHover}）`,
    hover);

  // P0-05 drag delivery
  const before = await probeState();
  const drag = await dragCss(`#${PROBE_ID}`, { dx: 90, dy: 60, holdMs: 80, dwellMs: 120 });
  await new Promise((r) => setTimeout(r, 200));
  const afterDrag = await probeState();
  const dx = afterDrag.upAt && afterDrag.downAt ? afterDrag.upAt[0] - afterDrag.downAt[0] : null;
  const dy = afterDrag.upAt && afterDrag.downAt ? afterDrag.upAt[1] - afterDrag.downAt[1] : null;
  // PointerEvent.screenX/clientX are CSS pixels, so a 90,60 CSS drag reads back
  // as 90,60 even though winapp travelled 112,75 physical pixels.
  record("P0-05", "拖拽投递", drag.ok && afterDrag.downs === before.downs + 1 && Math.abs(dx - 90) < 10 && Math.abs(dy - 60) < 10,
    `pointerdown→up 位移 ${dx},${dy} CSS px（期望 ≈90,60）moves=${afterDrag.moves - before.moves}`);

  await removeFixture();

  // P0-06 keyboard
  const keys = await sendKeys("ctrl+p");
  await new Promise((r) => setTimeout(r, 500));
  const palette = await pageEval(`
    const p = document.querySelector(".prompt");
    const input = document.querySelector(".prompt-input");
    return { open: !!p, focused: !!input && document.activeElement === input };
  `);
  record("P0-06", "send-keys 打开命令面板", palette.open && palette.focused,
    `prompt=${palette.open} focused=${palette.focused}`);
  await sendKeys("escape");
  await new Promise((r) => setTimeout(r, 300));

  // P0-10 screenshot size
  const shotPath = join(STATE, "probe-shot.png");
  const shot = await screenshot(shotPath);
  const size = shot.ok ? pngSize(shotPath) : null;
  record("P0-10", "截图尺寸", shot.ok && size.width === 1530 && size.height === 1019,
    shot.ok ? `${size.width}x${size.height}` : `失败: ${shot.message}`);

  // Recording: the picture must contain the pointer emphasis, or the whole
  // "show the operation" premise fails. winapp record and gdigrab disagree.
  await installFixture();
  await sendKeys("win+shift+h", { systemKeys: true });
  await new Promise((r) => setTimeout(r, 500));

  for (const engine of ["winapp", "gdigrab"]) {
    const file = join(STATE, `rec-${engine}.mp4`);
    const handle = engine === "winapp"
      ? startWinappRecord({ hwnd: a.hwnd, file, seconds: 4, fps: 30 })
      : startGdigrab({ win: a, file, seconds: 4, fps: 30 });
    await new Promise((r) => setTimeout(r, 1000));
    await movePointer(calib.origin.screen.x + 950 * calib.scale.x, calib.origin.screen.y + 650 * calib.scale.y);
    await new Promise((r) => setTimeout(r, 220));
    await clickCss(`#${PROBE_ID}`, { settle: 350 });
    await handle.done;
    const frame = join(STATE, `rec-${engine}.png`);
    extractFrame(file, 1.35, frame);
    const red = countRed(frame);
    // The arrow sits at the click point and extends down-right; the box covers
    // its body, in frame coordinates (frame 0,0 == window 0,0).
    const box = {
      x: calib.origin.image.x + (MARKER.css.x - 30) * calib.scale.x,
      y: calib.origin.image.y + (MARKER.css.y - 24) * calib.scale.y,
      w: 150, h: 150
    };
    const white = countWhite(frame, box);
    const meta = ffprobe(file);
    record(`P0-07${engine === "winapp" ? "a" : "b"}`, `${engine} 录制含光标`,
      engine === "gdigrab" ? white > 30 : white < 30,
      `光标白像素 ${white}，高亮红像素 ${red}；${meta ? `${meta.width}x${meta.height} ${meta.fps} ${meta.frames} 帧` : "无元数据"}`,
      { red, white, meta, frame }, { gate: engine === "gdigrab" });
  }

  await sendKeys("win+shift+h", { systemKeys: true });
  await removeFixture();

  const gate = results.filter((r) => r.gate);
  const report = {
    at: new Date().toISOString(),
    ms: Date.now() - t0,
    winapp: (await runWinapp(["--version"], { timeoutMs: 10000 })).stdout.trim().split("\n").pop(),
    passed: gate.filter((r) => r.ok).length,
    total: gate.length,
    results
  };
  writeFileSync(join(CACHE, "probe-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.passed === report.total ? 0 : 2);
}

await main();
