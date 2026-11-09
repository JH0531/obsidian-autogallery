#!/usr/bin/env node
// Capture interface stills through CDP: open a dialog, measure its box, take a
// screenshot, crop and encode. No native input, so the window is never raised.
//
//   node tools/capture/ui-stills.mjs settings
//   node tools/capture/ui-stills.mjs pdf
//   node tools/capture/ui-stills.mjs palette
//   node tools/capture/ui-stills.mjs reset
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:http";
import { prepare, restore, pageEval, sleep } from "./winapp/lib/scene.mjs";
import { setTheme } from "./lib/theme.mjs";
import { resolveVault } from "./lib/vault.mjs";
import { stillRel } from "./lib/media.mjs";

process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const action = process.argv[2];
const PORT = Number(process.env.CDP_PORT || 9333);
const ACTIONS = {
  settings: { note: "19-设置页.md", id: "AG-S20-01", selector: ".modal-container.mod-settings" },
  pdf: { note: "17-PDF导出.md", id: "AG-S18-01", selector: ".modal-container" },
  palette: { note: "20-命令与撤销.md", id: "AG-S22-01", selector: ".prompt" },
  reset: { note: "13-对话框与重置.md", id: "AG-S22-02", selector: ".modal-container" },
  annotation: { note: "13-对话框与重置.md", id: "AG-S14-01", selector: ".modal-container" },
  crop: { note: "11-裁剪.md", id: "AG-S12-04", selector: ".modal-container" }
};
if (!ACTIONS[action]) {
  console.error(`未知动作：${action}（可用：${Object.keys(ACTIONS).join(", ")}）`);
  process.exit(1);
}
const spec = ACTIONS[action];
const LANG = process.env.AG_LANG === "en" ? "en" : "zh";
const THEME = process.env.AG_THEME === "dark" ? "dark" : "light";
const vault = resolveVault();
const target = join(vault, stillRel(spec.id, LANG, THEME));
const cache = join(vault, ".cache", "ui-stills");
mkdirSync(cache, { recursive: true });
mkdirSync(join(vault, "media", LANG, THEME, "stills"), { recursive: true });

await setTheme(THEME);
const ctx = await prepare({ note: spec.note, mode: "source", calibrate: false, background: true });

const opened = await pageEval(`
  const action = ${JSON.stringify(action)};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  if (action === "settings") {
    app.setting.open();
    app.setting.openTabById("obsidian-autogallery");
    await wait(500);
    const content = document.querySelector(".modal-container.mod-settings .vertical-tab-content");
    if (content) content.scrollTop = 0;
  }
  if (action === "pdf") {
    app.commands.executeCommandById("obsidian-autogallery:export-pdf");
    await wait(1200);
  }
  if (action === "palette") {
    app.commands.executeCommandById("command-palette:open");
    await wait(400);
    const input = document.querySelector(".prompt-input");
    if (input) {
      input.value = "autogallery";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await wait(500);
    }
  }
  if (action === "crop") {
    const view = app.workspace.activeLeaf?.view;
    const editor = view?.editor;
    if (editor) {
      const line = Array.from({ length: editor.lineCount() }, (_, i) => i).find((i) => editor.getLine(i).includes("!["));
      if (line != null) { editor.setCursor({ line, ch: 0 }); await wait(500); }
    }
    document.querySelector(".ag-crop-action")?.click();
    await wait(1400);
  }
  if (action === "annotation") {
    const view = app.workspace.activeLeaf?.view;
    const editor = view?.editor;
    if (editor) {
      const line = Array.from({ length: editor.lineCount() }, (_, i) => i).find((i) => editor.getLine(i).includes("!["));
      if (line != null) { editor.setCursor({ line, ch: 0 }); await wait(250); }
    }
    app.commands.executeCommandById("obsidian-autogallery:set-image-annotation");
    await wait(900);
  }
  if (action === "reset") {
    app.commands.executeCommandById("obsidian-autogallery:reset-document-image-layout");
    await wait(600);
  }
  return true;
`);
await sleep(800);

const box = await pageEval(`
  const list = [...document.querySelectorAll(${JSON.stringify(spec.selector)})];
  const el = list.at(-1);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, dpr: window.devicePixelRatio || 1, count: list.length };
`);
if (!box) throw new Error(`找不到界面元素 ${spec.selector}`);

function probeTargets() {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: PORT, path: "/json/list", method: "GET", timeout: 2000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("probe timeout")));
    req.end();
  });
}

const page = (await probeTargets()).find((item) => item.type === "page" && item.webSocketDebuggerUrl);
if (!page) throw new Error("no page target");
const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;
await new Promise((resolve, reject) => {
  socket.addEventListener("open", () => resolve());
  socket.addEventListener("error", (event) => reject(new Error(String(event.message ?? "ws error"))));
});
socket.addEventListener("message", (event) => {
  let data;
  try { data = JSON.parse(String(event.data)); } catch { return; }
  if (data.id && pending.has(data.id)) {
    const entry = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) entry.reject(new Error(JSON.stringify(data.error)));
    else entry.resolve(data.result);
  }
});
const send = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const shot = await send("Page.captureScreenshot", { format: "png" });
const png = join(cache, `${spec.id}.png`);
writeFileSync(png, Buffer.from(shot.data, "base64"));
socket.close();

const pad = 10;
const scale = box.dpr || 1;
const x = Math.max(0, Math.round((box.x - pad) * scale));
const y = Math.max(0, Math.round((box.y - pad) * scale));
const w = Math.round((box.w + pad * 2) * scale);
const h = Math.round((box.h + pad * 2) * scale);
execFileSync("magick", [png, "-crop", `${w}x${h}+${x}+${y}`, "+repage", "-resize", "1500x", "-strip", "-quality", "85", "-define", "webp:method=6", target]);
if (statSync(target).size > 1200 * 1024) throw new Error("超过 1.2MB");

await pageEval(`
  try { app.setting.close(); } catch {}
  document.querySelector(".modal-container .modal-close-button")?.click();
  return true;
`).catch(() => {});
await restore(ctx);
await setTheme("dark");
console.log(JSON.stringify({ action, id: spec.id, target, box, bytes: statSync(target).size }, null, 2));
