#!/usr/bin/env node
// Locate the Obsidian window and cache its physical-screen rectangle.
//
// `ui list-windows` does not report position, `ui inspect` does. The window can
// be moved or resized between runs, so the cache expires quickly and every
// capture run re-resolves it.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { runWinapp } from "./winapp.mjs";
import { STATE } from "./env.mjs";

const CACHE = join(STATE, "window.json");
const TTL_MS = 60_000;
export const APP = "Obsidian";

export async function targetWindow({ refresh = false } = {}) {
  if (!refresh && existsSync(CACHE)) {
    const age = Date.now() - statSync(CACHE).mtimeMs;
    if (age < TTL_MS) return JSON.parse(readFileSync(CACHE, "utf8"));
  }

  const listed = await runWinapp(["ui", "list-windows", "-a", APP, "--json"], { timeoutMs: 15000 });
  if (!listed.ok) return { ok: false, code: listed.code, message: listed.message || "list-windows 失败" };
  const rows = Array.isArray(listed.data) ? listed.data : [];
  const main = rows.filter((r) => r.ownerHwnd === 0).sort((a, b) => b.width * b.height - a.width * a.height)[0];
  if (!main) return { ok: false, code: "no_window", message: "没找到 Obsidian 主窗口" };

  // Depth 1 returns an empty element list, so the window box (x/y) is only
  // reported at depth 2. The tree is shallow on Chromium, so this is cheap.
  const inspected = await runWinapp(["ui", "inspect", "-w", String(main.hwnd), "--depth", "2", "--json"], { timeoutMs: 20000 });
  if (!inspected.ok) return { ok: false, code: inspected.code, message: inspected.message || "inspect 失败" };
  const win = (inspected.data.windows || [])[0] || {};
  // x/y live on the root element, not on the window record.
  const root = (win.elements || [])[0] || {};
  const scale = win.scale ?? 1;

  const value = {
    ok: true,
    hwnd: main.hwnd,
    title: main.title,
    pid: main.processId,
    x: root.x, y: root.y,
    width: root.width ?? main.width,
    height: root.height ?? main.height,
    scale,
    coordinateSpace: win.coordinateSpace ?? "physical-screen-pixels",
    at: new Date().toISOString()
  };
  mkdirSync(STATE, { recursive: true });
  writeFileSync(CACHE, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}
