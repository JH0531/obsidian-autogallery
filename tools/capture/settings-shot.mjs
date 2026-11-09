#!/usr/bin/env node
// Capture the AutoGallery settings tab from its own BrowserWindow.
// The settings UI lives in a second CDP target (about:blank), not in the note
// renderer, so this connects to that target directly.
import { execFileSync } from "node:child_process";
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pageEval, listPages } from "./winapp/cdp.mjs";
import { setTheme } from "./lib/theme.mjs";
import { resolveVault } from "./lib/vault.mjs";
import { stillRel } from "./lib/media.mjs";

process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const argv = process.argv.slice(2);
const value = (name, fallback) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : fallback; };
const id = value("--id", "AG-S20-01");
const tab = value("--tab", null);
const LANG = process.env.AG_LANG === "en" ? "en" : "zh";
const THEME = process.env.AG_THEME === "dark" ? "dark" : "light";
const vault = resolveVault();
const target = join(vault, stillRel(id, LANG, THEME));
const cache = join(vault, ".cache", "ui-stills");
mkdirSync(cache, { recursive: true });
mkdirSync(join(vault, "media", LANG, THEME, "stills"), { recursive: true });

await setTheme(THEME);
await pageEval(`app.setting.open(); app.setting.openTabById("obsidian-autogallery"); return true`);
await new Promise((resolve) => setTimeout(resolve, 1500));

const pages = await listPages();
const settings = pages.find((page) => page.title.includes("设置") || page.url === "about:blank");
if (!settings) throw new Error("找不到设置窗口 target");

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(wsUrl);
    const pending = new Map();
    let nextId = 1;
    socket.addEventListener("open", () => resolve({
      socket,
      send: (method, params) => new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { resolve: res, reject: rej });
        socket.send(JSON.stringify({ id, method, params }));
      })
    }));
    socket.addEventListener("error", (event) => reject(new Error(String(event.message ?? "ws error"))));
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
  });
}

const client = await connect(settings.webSocketDebuggerUrl);
await client.send("Runtime.enable", {});
if (tab) {
  await client.send("Runtime.evaluate", { expression: `[...document.querySelectorAll(".ag-nav-item")].find((n)=>n.textContent.includes(${JSON.stringify(tab)}))?.click(); true`, returnByValue: true });
  await new Promise((resolve) => setTimeout(resolve, 900));
}
const expression = `(() => {
  const el = document.querySelector(".vertical-tab-content") || document.querySelector(".modal") || document.body;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height, dpr: window.devicePixelRatio || 1 };
})()`;
const evaluated = await client.send("Runtime.evaluate", { expression, returnByValue: true });
const box = evaluated.result?.value;
if (!box) throw new Error("设置窗口没有可测量的内容");

const shot = await client.send("Page.captureScreenshot", { format: "png" });
const png = join(cache, "AG-S20-01-settings.png");
writeFileSync(png, Buffer.from(shot.data, "base64"));
client.socket.close();

const pad = 8;
const scale = box.dpr || 1;
const x = Math.max(0, Math.round((box.x - pad) * scale));
const y = Math.max(0, Math.round((box.y - pad) * scale));
const w = Math.round((box.w + pad * 2) * scale);
const h = Math.round((box.h + pad * 2) * scale);
execFileSync("magick", [png, "-crop", `${w}x${h}+${x}+${y}`, "+repage", "-resize", "1500x", "-strip", "-quality", "85", "-define", "webp:method=6", target]);
if (statSync(target).size > 1200 * 1024) throw new Error("超过 1.2MB");

await pageEval(`try { app.setting.close(); } catch {} return true`).catch(() => {});
await setTheme("dark");
console.log(JSON.stringify({ id, target, box, bytes: statSync(target).size }, null, 2));
