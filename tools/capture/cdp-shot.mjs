#!/usr/bin/env node
// Capture the current Obsidian window after running a snippet, so a layout can
// be judged by eye instead of by numbers alone.
//
//   node tools/capture/cdp-shot.mjs <file.js> <out.png> [--port 9333]
//
// Screenshots only contain pixels when a window is actually visible; a hidden
// window gives a blank image while `eval` still works.
import { readFileSync, writeFileSync } from "node:fs";
import { request } from "node:http";

process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

const [file, out] = process.argv.slice(2);
const portIndex = process.argv.indexOf("--port");
const port = portIndex > 0 ? Number(process.argv[portIndex + 1]) : 9333;

function probeTargets() {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, path: "/json/list", method: "GET", timeout: 2000 }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { body += c; });
      res.on("end", () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("probe timeout")));
    req.end();
  });
}

const page = (await probeTargets()).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page) throw new Error("no page target");

const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;
await new Promise((resolve, reject) => {
  socket.addEventListener("open", () => resolve());
  socket.addEventListener("error", (e) => reject(new Error(String(e.message ?? "ws error"))));
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

await send("Runtime.enable", {});
const expression = `(async () => { const __src = ${JSON.stringify(readFileSync(file, "utf8"))}; return await eval(__src); })()`;
const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
if (result.exceptionDetails) {
  console.error(JSON.stringify(result.exceptionDetails).slice(0, 600));
  process.exit(2);
}
await new Promise((r) => setTimeout(r, 400));
const shot = await send("Page.captureScreenshot", { format: "png" });
writeFileSync(out, Buffer.from(shot.data, "base64"));
console.log("saved", out, "| eval:", JSON.stringify(result.result?.value ?? null).slice(0, 200));
socket.close();
