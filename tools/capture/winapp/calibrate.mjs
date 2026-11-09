#!/usr/bin/env node
// Measure the css -> screen mapping instead of assuming devicePixelRatio.
//
//   node tools/capture/winapp/calibrate.mjs [--json] [--verify]
//
// Four saturated markers are injected at known CSS positions, the window is
// captured, and the marker centroids solve the affine map. A claim like "the
// window is at 256,106 and scale is 1.25" is a guess about DWM borders; the
// centroids are not.

import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { CACHE, STATE } from "./env.mjs";
import { pageEval } from "./cdp.mjs";
import { saveCalib, loadCalib } from "./rect.mjs";
import { runWinapp } from "./winapp.mjs";
import { targetWindow } from "./window.mjs";

const COLORS = ["#FF00FF", "#00FFFF", "#FFFF00", "#00FF00"];
const SIZE = 16;

const addMarkers = (colors, size) => `
  const host = document.createElement("div");
  host.id = "__ag_calib_host";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483647;pointer-events:none;";
  document.body.appendChild(host);
  const W = innerWidth, H = innerHeight;
  const SIZE = ${size};
  const COLORS = ${JSON.stringify(colors)};
  const spots = [[48, 48], [W - 48, 48], [48, H - 48], [W - 48, H - 48]];
  const out = [];
  spots.forEach((spot, i) => {
    const d = document.createElement("div");
    d.style.position = "fixed";
    d.style.width = SIZE + "px";
    d.style.height = SIZE + "px";
    d.style.background = COLORS[i];
    d.style.left = (spot[0] - SIZE / 2) + "px";
    d.style.top = (spot[1] - SIZE / 2) + "px";
    d.style.pointerEvents = "none";
    host.appendChild(d);
    const r = d.getBoundingClientRect();
    out.push({ color: COLORS[i], cx: r.x + r.width / 2, cy: r.y + r.height / 2 });
  });
  return { viewport: { w: W, h: H }, dpr: devicePixelRatio, markers: out };
`;

const removeMarkers = `
  const host = document.getElementById("__ag_calib_host");
  if (host) host.remove();
  return true;
`;

function decodePng(path) {
  // PNG IHDR: width at bytes 16..20, height at 20..24.
  const head = readFileSync(path).subarray(0, 24);
  const width = head.readUInt32BE(16);
  const height = head.readUInt32BE(20);

  const result = spawnSync("ffmpeg", ["-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], {
    maxBuffer: 512 * 1024 * 1024
  });
  if (result.status !== 0) throw new Error(`ffmpeg 解码失败: ${String(result.stderr).slice(0, 200)}`);
  const buf = result.stdout;
  if (buf.length !== width * height * 3) throw new Error(`解码尺寸不符: ${buf.length} != ${width * height * 3}`);
  return { buf, width, height };
}

function centroid({ buf, width, height }, hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < height; y++) {
    let row = y * width * 3;
    for (let x = 0; x < width; x++, row += 3) {
      const dr = buf[row] - r, dg = buf[row + 1] - g, db = buf[row + 2] - b;
      if (dr > -14 && dr < 14 && dg > -14 && dg < 14 && db > -14 && db < 14) { sx += x; sy += y; n++; }
    }
  }
  return n ? { x: sx / n, y: sy / n, n } : null;
}

function fit(pairs) {
  // Least squares for v = a*u + b.
  const n = pairs.length;
  const su = pairs.reduce((s, p) => s + p[0], 0);
  const sv = pairs.reduce((s, p) => s + p[1], 0);
  const suu = pairs.reduce((s, p) => s + p[0] * p[0], 0);
  const suv = pairs.reduce((s, p) => s + p[0] * p[1], 0);
  const denom = n * suu - su * su;
  const a = (n * suv - su * sv) / denom;
  const b = (sv - a * su) / n;
  const residual = Math.max(...pairs.map(([u, v]) => Math.abs(v - (a * u + b))));
  return { scale: a, offset: b, residual };
}

export async function calibrate({ quiet = false } = {}) {
  mkdirSync(CACHE, { recursive: true });
  const win = await targetWindow({ refresh: true });
  if (!win.ok) return { ok: false, code: win.code, message: win.message };

  const injected = await pageEval(addMarkers(COLORS, SIZE));
  const shotPath = join(STATE, "calib.png");
  let shot;
  try {
    shot = await runWinapp(
      ["ui", "screenshot", "-w", String(win.hwnd), "--capture-screen", "-o", shotPath, "--json"],
      { timeoutMs: 25000 }
    );
  } finally {
    await pageEval(removeMarkers).catch(() => {});
  }
  if (!shot.ok) return { ok: false, code: shot.code, message: shot.message || "截图失败" };

  const image = decodePng(shotPath);
  const found = injected.markers.map((m) => {
    const c = centroid(image, m.color);
    if (!c || c.n < 40) throw new Error(`标定色块 ${m.color} 未找到（${c ? c.n : 0} 像素）`);
    return { ...m, ...c };
  });

  const fx = fit(found.map((m) => [m.cx, m.x]));
  const fy = fit(found.map((m) => [m.cy, m.y]));

  const calib = {
    ok: true,
    at: new Date().toISOString(),
    hwnd: win.hwnd,
    scale: { x: +fx.scale.toFixed(4), y: +fy.scale.toFixed(4) },
    origin: {
      // Where css (0,0) sits inside the screenshot.
      image: { x: +(fx.offset).toFixed(2), y: +(fy.offset).toFixed(2) },
      // ...and on the physical screen: the screenshot starts at the window box.
      screen: { x: +(win.x + fx.offset).toFixed(2), y: +(win.y + fy.offset).toFixed(2) }
    },
    residualPx: +Math.max(fx.residual, fy.residual).toFixed(2),
    window: { x: win.x, y: win.y, width: win.width, height: win.height },
    viewport: injected.viewport,
    dpr: injected.dpr,
    image: { width: image.width, height: image.height },
    markers: found.map((m) => ({ color: m.color, css: [+m.cx.toFixed(1), +m.cy.toFixed(1)], image: [+m.x.toFixed(1), +m.y.toFixed(1)], pixels: m.n }))
  };

  saveCalib(calib);
  if (!quiet) process.stderr.write(`标定: scale=${calib.scale.x}/${calib.scale.y} 屏幕原点=${calib.origin.screen.x},${calib.origin.screen.y} 残差=${calib.residualPx}px 截图=${image.width}x${image.height}\n`);
  return calib;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const wantJson = process.argv.includes("--json");
  const result = await calibrate({ quiet: wantJson });
  process.stdout.write(`${JSON.stringify(result, null, wantJson ? 0 : 2)}\n`);
  process.exit(result.ok ? 0 : 1);
}
