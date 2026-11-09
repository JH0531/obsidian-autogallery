#!/usr/bin/env node
// Read and write the CSS-pixel -> physical-screen-pixel calibration, and expose
// the DOM queries the capture layer needs.
//
// Three coordinate spaces are in play:
//   css      viewport-relative CSS pixels (what getBoundingClientRect returns)
//   image    pixels inside a winapp screenshot of the window
//   screen   physical screen pixels (what winapp --at / drag endpoints take)
// Calibration solves css -> image from marker centroids, then adds the window
// origin reported by winapp to get screen.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { STATE } from "./env.mjs";
import { pageEval } from "./cdp.mjs";

export const CALIB_PATH = join(STATE, "calib.json");

export function loadCalib() {
  if (!existsSync(CALIB_PATH)) return null;
  return JSON.parse(readFileSync(CALIB_PATH, "utf8"));
}

export function saveCalib(value) {
  mkdirSync(STATE, { recursive: true });
  writeFileSync(CALIB_PATH, `${JSON.stringify(value, null, 2)}\n`);
  return value;
}

export function cssToScreen(calib, x, y) {
  const sx = calib.origin.screen.x + x * calib.scale.x;
  const sy = calib.origin.screen.y + y * calib.scale.y;
  return { x: Math.round(sx), y: Math.round(sy) };
}

export function cssToImage(calib, x, y) {
  return {
    x: Math.round(calib.origin.image.x + x * calib.scale.x),
    y: Math.round(calib.origin.image.y + y * calib.scale.y)
  };
}

// Scroll the element into view, let layout settle, then report its box. The two
// rAFs matter: a scroll issued in the same frame still returns stale geometry.
export async function rectOf(selector, { timeoutMs = 8000 } = {}) {
  return pageEval(`
    const sel = ${JSON.stringify(selector)};
    const el = document.querySelector(sel);
    if (!el) return { ok: false, code: "not_found", selector: sel };
    el.scrollIntoView({ block: "center", inline: "nearest" });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 120));
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    return {
      ok: true,
      selector: sel,
      x: r.x, y: r.y, width: r.width, height: r.height,
      cx, cy,
      inViewport: r.y > -1 && r.y + r.height < innerHeight + 1,
      hit: hit === el || el.contains(hit) || (hit && hit.contains(el)),
      hitTag: hit ? hit.className && String(hit.className).slice(0, 40) : null
    };
  `, { timeoutMs });
}

// Does the point actually land on the element (or its subtree)? Used before
// every injected click: it catches overlays that are visible but ignore the
// pointer, which is how the action bar behaves while hidden.
export async function hitTestAt(selector, cssX, cssY) {
  return pageEval(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return { ok: false, code: "not_found" };
    const hit = document.elementFromPoint(${cssX}, ${cssY});
    const inside = hit && (hit === el || el.contains(hit) || hit.contains(el));
    return { ok: !!inside, hitTag: hit ? String(hit.className || hit.tagName).slice(0, 60) : null };
  `);
}

export async function computed(selector, prop) {
  return pageEval(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    return getComputedStyle(el).getPropertyValue(${JSON.stringify(prop)});
  `);
}

export async function isHovered(selector) {
  return pageEval(`
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    return el.matches(":hover");
  `);
}
