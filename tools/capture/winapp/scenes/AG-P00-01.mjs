// AG-P00-01 — README 海报：dark 左半 + light 右半拼板，滚到底再滚回（APNG 循环）。
//
// The poster is language-specific only: it is one file that has to look right in
// both themes, so it is shot twice with identical scroll parameters and the two
// takes are stitched down the middle. Frames are captured through CDP rather than
// recorded from the screen: two passes must line up frame for frame, and a
// recorder cannot promise that.
//
// Delivery: 1000x600, 30fps, 8-bit palette, 72dpi, APNG (GitHub transcodes an
// animated WebP and drops the frames).
import { join } from "node:path";
import { writeFileSync, mkdirSync, existsSync, rmSync, readFileSync } from "node:fs";
import { prepare, restore, sleep, pageEval, setTheme, CACHE, VAULT, pageEval as evalPage } from "../lib/scene.mjs";
import { posterRel, posterId } from "../../lib/media.mjs";
import { spawnSync } from "node:child_process";

const NOTE = "00-效果总览.md";
const FPS = 30;
// One screen, not the whole note: at a readable speed a full-page pass is a
// 20-second loop, and the poster only has to show the gallery reflowing.
const DOWN_MS = 2700;
const UP_MS = 2700;
const HOLD_MS = 300;
const TAIL_MS = 1000;
const WIDTH = 1000;
const HEIGHT = 600;
// 128 colours at 10fps lands at ~8.5 MB; 256 costs another 1.1 MB for no visible
// gain once dithering is on.
const COLORS = 128;
const PLAY_FPS = 10;

const ctx = await prepare({ note: NOTE, mode: "preview" });
const work = join(CACHE, "poster");
for (const theme of ["dark", "light"]) {
  const dir = join(work, theme);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

const pass = async (theme, dir) => {
  const out = await pageEval(`
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const sc = document.querySelector(".markdown-preview-view") || document.querySelector(".cm-scroller");
    if (!sc) return { error: "no scroller" };
    const max = Math.min(Math.max(0, sc.scrollHeight - sc.clientHeight), sc.clientHeight);
    const ew = window.electronWindow;
    if (!ew?.webContents?.capturePage) return { error: "no capturePage" };

    const fps = ${FPS};
    const downFrames = Math.round((${DOWN_MS} / 1000) * fps);
    const upFrames = Math.round((${UP_MS} / 1000) * fps);
    const holdFrames = Math.round((${HOLD_MS} / 1000) * fps);
    const tailFrames = Math.round((${TAIL_MS} / 1000) * fps);
    const ease = (k) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);

    // Down, hold, up, then a full second at the top: the tail is what makes the
    // restart read as a loop instead of a jump cut.
    const positions = [];
    for (let i = 0; i < downFrames; i++) positions.push(max * ease(i / (downFrames - 1)));
    for (let i = 0; i < holdFrames; i++) positions.push(max);
    for (let i = 0; i < upFrames; i++) positions.push(max * (1 - ease(i / (upFrames - 1))));
    for (let i = 0; i < tailFrames; i++) positions.push(0);

    let written = 0;
    for (let i = 0; i < positions.length; i++) {
      sc.scrollTop = positions[i];
      await nextFrame();
      const image = await ew.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 800 });
      await app.vault.adapter.writeBinary(\`${dir.replace(/\\/g, "/").replace(VAULT.replace(/\\/g, "/"), "")}/\${String(i).padStart(4, "0")}.png\`, image.toPNG());
      written++;
    }
    return { frames: written, max: Math.round(max) };
  `, { timeoutMs: 300000 });
  return out;
};

const darkDir = join(work, "dark");
const lightDir = join(work, "light");

const dark = await pass("dark", darkDir);
await setTheme("light");
await sleep(600);
const light = await pass("light", lightDir);
await setTheme("dark");

const rel = posterRel(posterId("AG-V00-01"), "zh");
const out = join(VAULT, rel);
mkdirSync(join(out, ".."), { recursive: true });

const frameCount = Math.min(dark.frames ?? 0, light.frames ?? 0);
if (!frameCount) throw new Error("海报帧未生成");

// Stitch: left half of the dark take, right half of the light one, then palette.
const filter = [
  `[0:v]crop=1500:900:0:50,scale=${WIDTH}:${HEIGHT}:flags=lanczos[a]`,
  `[1:v]crop=1500:900:0:50,scale=${WIDTH}:${HEIGHT}:flags=lanczos[b]`,
  `[a]crop=${WIDTH / 2}:${HEIGHT}:0:0[al]`,
  `[b]crop=${WIDTH / 2}:${HEIGHT}:${WIDTH / 2}:0[br]`,
  `[al][br]hstack[out]`
].join(";");

const palette = join(work, "palette.png");
const composite = join(work, "composite.mp4");
spawnSync("ffmpeg", ["-v", "error", "-y",
  "-framerate", String(FPS), "-i", join(darkDir, "%04d.png"),
  "-framerate", String(FPS), "-i", join(lightDir, "%04d.png"),
  "-filter_complex", filter, "-map", "[out]",
  "-c:v", "libx264", "-crf", "12", "-pix_fmt", "yuv420p", composite], { windowsHide: true });

// APNG frames are full images: photographic content costs ~100-140 KB each, so
// the frame count — not the palette or the zlib level — is the only real lever.
// The capture runs at 30fps so the scroll itself is smooth; playback drops to
// PLAY_FPS at the *same* wall-clock duration, which keeps the motion slow
// instead of trading speed for size.
spawnSync("ffmpeg", ["-v", "error", "-y", "-i", composite,
  "-vf", `fps=${PLAY_FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos,palettegen=max_colors=${COLORS}:stats_mode=diff`, palette], { windowsHide: true });
spawnSync("ffmpeg", ["-v", "error", "-y", "-i", composite, "-i", palette,
  "-lavfi", `fps=${PLAY_FPS},scale=${WIDTH}:${HEIGHT}:flags=lanczos[x];[x][1:v]paletteuse=dither=sierra2_4a`,
  "-plays", "0", "-dpi", "72", "-pred", "mixed", "-compression_level", "9", "-f", "apng", out], { windowsHide: true });

await restore(ctx);

const { statSync } = await import("node:fs");
console.log(JSON.stringify({
  dark, light, frames: frameCount, rel, out,
  size: existsSync(out) ? statSync(out).size : null
}, null, 1));
