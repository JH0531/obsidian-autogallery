#!/usr/bin/env node
// The action layer: where to act, then how to act.
//
// Division of labour, forced by winapp 0.7.1's actual surface:
//   * click / drag / keys / screenshot / record  -> winapp (SendInput, real input)
//   * move the pointer without pressing         -> AutoHotkey (winapp has no
//     coordinate hover; `ui hover` only takes a UIA selector, and Chromium
//     exposes four nodes for the whole app, none of them DOM elements)
//   * a click at a coordinate                   -> `ui drag x,y x,y` (winapp's
//     drag accepts screen coordinates; from == to is a press-and-release)

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AHK, HERE } from "./env.mjs";
import { runWinapp, withRetry } from "./winapp.mjs";
import { cssToScreen, loadCalib, rectOf, hitTestAt } from "./rect.mjs";
import { targetWindow } from "./window.mjs";

const POINTER_AHK = join(HERE, "pointer.ahk");

function runAhk(args, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const child = spawn(AHK, [POINTER_AHK, ...args], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (b) => { stdout += b; });
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    timer.unref?.();
    child.on("error", (e) => { clearTimeout(timer); resolve({ ok: false, message: String(e.message) }); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, code, stdout: stdout.trim() }); });
  });
}

// Speed must be non-zero: 0 uses SetCursorPos, which relocates the cursor
// without synthesising mouse input, so Chromium never raises :hover.
export const movePointer = (x, y, speed = 2) => runAhk(["move", String(x), String(y), String(speed)]);
export const focusWindow = () => runAhk(["focus"]);
export const pointerPos = async () => {
  const r = await runAhk(["pos"]);
  const [x, y] = String(r.stdout).split(",").map(Number);
  return { ok: r.ok, x, y };
};
export const keyDown = (k) => runAhk(["down", k]);
export const keyUp = (k) => runAhk(["up", k]);
export const releaseAll = () => runAhk(["allup"]);

export async function requireContext() {
  const calib = loadCalib();
  if (!calib) throw new Error("缺少标定，先运行 calibrate.mjs");
  const win = await targetWindow();
  if (!win.ok) throw new Error(`窗口不可用: ${win.message}`);
  if (win.hwnd !== calib.hwnd) {
    throw new Error(`标定属于旧窗口（${calib.hwnd} != ${win.hwnd}），重新标定`);
  }
  return { calib, win };
}

export async function screenOfCss(selector, { dx = 0, dy = 0, scroll = true } = {}) {
  const { calib } = await requireContext();
  const rect = scroll ? await rectOf(selector) : await rectOf(selector);
  if (!rect || !rect.ok) return { ok: false, code: rect?.code || "not_found", selector };
  const cssX = rect.x + (dx === null ? rect.width / 2 : rect.width / 2 + dx);
  const cssY = rect.y + (dy === null ? rect.height / 2 : rect.height / 2 + dy);
  return { ok: true, rect, css: { x: cssX, y: cssY }, screen: cssToScreen(calib, cssX, cssY) };
}

async function ensureHit(selector, point, { tries = 2 } = {}) {
  for (let i = 0; i < tries; i++) {
    const hit = await hitTestAt(selector, point.css.x, point.css.y);
    if (hit.ok) return { ok: true, hit };
    // The bar and the handles reveal on hover; a hidden overlay answers
    // elementFromPoint with whatever is underneath until the pointer arrives.
    await movePointer(point.screen.x, point.screen.y);
    await new Promise((r) => setTimeout(r, 220));
  }
  const hit = await hitTestAt(selector, point.css.x, point.css.y);
  return { ok: false, hit };
}

export async function hoverCss(selector, { dx = 0, dy = 0, dwell = 600 } = {}) {
  const point = await screenOfCss(selector, { dx, dy });
  if (!point.ok) return point;
  const moved = await movePointer(point.screen.x, point.screen.y);
  if (!moved.ok) return { ok: false, code: "ahk", message: "指针移动失败" };
  await new Promise((r) => setTimeout(r, dwell));
  return { ok: true, op: "hover", css: point.css, screen: point.screen };
}

// Every injecting verb needs an explicit target. Without -w/-a the drag reports
// success and delivers nothing, which looks identical to a missed coordinate.
async function windowArgs() {
  const { win } = await requireContext();
  return ["-w", String(win.hwnd)];
}

// winapp 0.7.1 has no `click --at`. Dragging from a point to itself is a
// press-and-release at that point, which is a click.
async function pressRelease(point, { right = false, holdMs = 0 } = {}) {
  const args = ["ui", "drag", `${point.screen.x},${point.screen.y}`, `${point.screen.x},${point.screen.y}`];
  if (right) args.push("--right");
  if (holdMs) args.push("--hold-ms", String(holdMs));
  args.push(...(await windowArgs()), "--json");
  return withRetry("click", () => runWinapp(args, { timeoutMs: 20000 }));
}

export async function clickCss(selector, { dx = 0, dy = 0, right = false, settle = 180 } = {}) {
  const point = await screenOfCss(selector, { dx, dy });
  if (!point.ok) return point;
  const hit = await ensureHit(selector, point);
  if (!hit.ok) return { ok: false, code: "not_hittable", css: point.css, screen: point.screen, hitTag: hit.hit?.hitTag };
  await movePointer(point.screen.x, point.screen.y);
  await new Promise((r) => setTimeout(r, 120));
  const res = await pressRelease(point, { right });
  if (!res.ok) return { ok: false, code: res.code, message: res.message };
  await new Promise((r) => setTimeout(r, settle));
  return { ok: true, op: "click", css: point.css, screen: point.screen };
}

export async function doubleClickCss(selector, { dx = 0, dy = 0, gapMs = 60 } = {}) {
  const point = await screenOfCss(selector, { dx, dy });
  if (!point.ok) return point;
  const hit = await ensureHit(selector, point);
  if (!hit.ok) return { ok: false, code: "not_hittable", css: point.css };
  await movePointer(point.screen.x, point.screen.y);
  const first = await pressRelease(point);
  await new Promise((r) => setTimeout(r, gapMs));
  const second = await pressRelease(point);
  await new Promise((r) => setTimeout(r, 250));
  return { ok: first.ok && second.ok, op: "doubleClick", css: point.css, screen: point.screen, first: first.code, second: second.code };
}

export async function dragCss(selector, { dx = 0, dy = 0, fromDx = 0, fromDy = 0, steps = 1, holdMs = 120, dwellMs = 300 } = {}) {
  const point = await screenOfCss(selector, { dx: fromDx, dy: fromDy });
  if (!point.ok) return point;
  const hit = await ensureHit(selector, point);
  if (!hit.ok) return { ok: false, code: "not_hittable", css: point.css, hitTag: hit.hit?.hitTag };

  const toX = point.screen.x + Math.round(dx * 1.25);
  const toY = point.screen.y + Math.round(dy * 1.25);

  await movePointer(point.screen.x, point.screen.y);
  await new Promise((r) => setTimeout(r, 150));

  // One winapp drag emits interpolated move frames; `steps` only controls how
  // far apart the sampled waypoints are when we need a slower, readable path.
  const args = ["ui", "drag", `${point.screen.x},${point.screen.y}`, `${toX},${toY}`,
    "--hold-ms", String(holdMs), "--dwell-ms", String(dwellMs), ...(await windowArgs()), "--json"];
  const res = await runWinapp(args, { timeoutMs: 30000 });
  if (!res.ok) return { ok: false, code: res.code, message: res.message, from: point.screen, to: { x: toX, y: toY } };
  await new Promise((r) => setTimeout(r, 250));
  return { ok: true, op: "drag", css: point.css, from: point.screen, to: { x: toX, y: toY }, steps };
}

export async function sendKeys(keys, { via = "send-input", systemKeys = false } = {}) {
  const args = ["ui", "send-keys", keys, "--via", via];
  if (systemKeys) args.push("--allow-system-keys");
  args.push(...(await windowArgs()), "--json");
  const res = await withRetry("keys", () => runWinapp(args, { timeoutMs: 20000 }));
  return { ok: res.ok, code: res.code, message: res.message, data: res.data };
}

export async function screenshot(outPath, { hwnd } = {}) {
  const { win } = await requireContext();
  const args = ["ui", "screenshot", "-w", String(hwnd || win.hwnd), "--capture-screen", "-o", outPath, "--json"];
  const res = await runWinapp(args, { timeoutMs: 30000 });
  return res.ok ? { ok: true, data: res.data, path: outPath } : { ok: false, code: res.code, message: res.message };
}

export function pngSize(path) {
  const head = readFileSync(path).subarray(0, 24);
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}
