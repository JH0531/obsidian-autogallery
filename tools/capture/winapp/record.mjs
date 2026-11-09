#!/usr/bin/env node
// Recording orchestration.
//
// Measured facts (Phase 0, 2026-11-07):
//  * `winapp ui record` uses the screen DC, which does NOT contain the cursor
//    overlay. Frames have no pointer at all.
//  * `ffmpeg -f gdigrab -draw_mouse 1` composites the cursor itself and also
//    picks up the PowerToys highlighter ring.
// So gdigrab is the primary channel and winapp record is the fallback. Both are
// driven from here so the scenario runner does not care which one ran.

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";

export function newWorkflowId() {
  const id = randomUUID();
  process.env.WINAPP_UI_WORKFLOW_ID = id;
  return id;
}

// libx264 rejects odd dimensions; the window is 1530x1019.
const even = (n) => n & ~1;

export function startGdigrab({ win, file, seconds, fps = 30, crf = 20 }) {
  const args = ["-v", "error", "-y",
    "-f", "gdigrab", "-framerate", String(fps), "-draw_mouse", "1",
    "-offset_x", String(win.x), "-offset_y", String(win.y),
    "-video_size", `${even(win.width)}x${even(win.height)}`,
    "-t", String(seconds), "-i", "desktop",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", String(crf), "-pix_fmt", "yuv420p",
    file];
  const child = spawn("ffmpeg", args, { windowsHide: true });
  const done = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  let stderr = "";
  child.stderr.on("data", (b) => { stderr += b; });
  return { engine: "gdigrab", file, child, done, get stderr() { return stderr; } };
}

// `screen: false` records the window surface through WGC instead of the screen
// region. A window that does not report its screen position (the settings
// dialog) can only be recorded this way: BitBlt on the reported rect captures
// whatever happens to be there, which was the note window behind it.
export function startWinappRecord({ hwnd, file, seconds, fps = 30, screen = true }) {
  const args = ["ui", "record", "-w", String(hwnd), ...(screen ? ["--capture-screen"] : []),
    "--fps", String(fps), "--duration-sec", String(seconds), "--max-edge", "0",
    "--overwrite", "-o", file, "--json"];
  const child = spawn("winapp.exe", args, { env: process.env, windowsHide: true });
  const done = new Promise((resolve) => child.on("close", (code) => resolve(code)));
  let stdout = "", stderr = "";
  child.stdout.on("data", (b) => { stdout += b; });
  child.stderr.on("data", (b) => { stderr += b; });
  return { engine: "winapp", file, child, done, get stdout() { return stdout; }, get stderr() { return stderr; } };
}

// Grab exactly one frame, cursor and overlays included.
export function grabFrame({ win, file }) {
  const args = ["-v", "error", "-y", "-f", "gdigrab", "-draw_mouse", "1",
    "-offset_x", String(win.x), "-offset_y", String(win.y),
    "-video_size", `${even(win.width)}x${even(win.height)}`,
    "-i", "desktop", "-frames:v", "1", file];
  const r = spawnSync("ffmpeg", args, { windowsHide: true });
  return { ok: r.status === 0, file, stderr: String(r.stderr || "").slice(-200) };
}

export function ffprobe(file) {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate,nb_frames,duration",
    "-of", "json", file], { windowsHide: true });
  try {
    const s = JSON.parse(String(r.stdout)).streams[0];
    return { width: s.width, height: s.height, fps: s.r_frame_rate, frames: Number(s.nb_frames), duration: Number(s.duration) };
  } catch {
    return null;
  }
}

export function extractFrame(file, t, out) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(t), "-i", file, "-frames:v", "1", out], { windowsHide: true });
  return { ok: r.status === 0, out };
}

// Count near-white pixels inside a box. A dark probe surface plus a white arrow
// cursor makes this a reliable "is the pointer in the picture" test.
export function countWhite(file, box) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) return -1;
  const buf = r.stdout;
  const head = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", file], { windowsHide: true });
  const [w, h] = String(head.stdout).trim().split(",").map(Number);
  if (!w || !h) return -1;
  const x0 = Math.max(0, Math.floor(box.x));
  const y0 = Math.max(0, Math.floor(box.y));
  const x1 = Math.min(w, Math.ceil(box.x + box.w));
  const y1 = Math.min(h, Math.ceil(box.y + box.h));
  let n = 0;
  for (let y = y0; y < y1; y++) {
    let i = (y * w + x0) * 3;
    for (let x = x0; x < x1; x++, i += 3) {
      if (buf[i] > 225 && buf[i + 1] > 225 && buf[i + 2] > 225) n++;
    }
  }
  return n;
}

// Count PowerToys-style red highlight pixels in one frame.
export function countRed(file) {
  const r = spawnSync("ffmpeg", ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) return -1;
  const buf = r.stdout;
  let n = 0;
  for (let i = 0; i < buf.length; i += 3) {
    if (buf[i] > 165 && buf[i + 1] < 95 && buf[i + 2] < 95) n++;
  }
  return n;
}
