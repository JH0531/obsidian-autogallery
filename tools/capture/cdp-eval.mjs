#!/usr/bin/env node
// Run a snippet inside the Obsidian renderer over the DevTools protocol.
//
//   node tools/capture/cdp-eval.mjs <file.js> [--port 9333] [--timeout 120] [--args-file .ag-args.json]
//
// Obsidian must be running with `--remote-debugging-port=<port>`. The CLI that
// ships with Obsidian drops the response channel on this machine, so this is
// the reliable way to read a value back out of the renderer.
//
// With --args-file the file's raw text is injected as `globalThis.__AG_ARGS__`,
// which is what the capture scripts expect.

import { readFileSync, existsSync } from "node:fs";
import { request } from "node:http";

// The DevTools endpoint is loopback-only. Undici's fetch honours the machine's
// HTTP_PROXY and answers ECONNREFUSED for it, which looks exactly like
// "Obsidian is not running". Plain http.request bypasses that entirely.
process.env.NO_PROXY = "127.0.0.1,localhost";
process.env.no_proxy = "127.0.0.1,localhost";

function probeTargets(port) {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: "127.0.0.1", port, path: "/json/list", method: "GET", timeout: 2000 },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { body += chunk; });
        res.on("end", () => {
          try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => req.destroy(new Error("probe timeout")));
    req.end();
  });
}

const args = process.argv.slice(2);
const file = args[0];
const portIndex = args.indexOf("--port");
const port = portIndex > 0 ? Number(args[portIndex + 1]) : Number(process.env.CDP_PORT ?? 9333);
const timeoutIndex = args.indexOf("--timeout");
const timeoutMs = (timeoutIndex > 0 ? Number(args[timeoutIndex + 1]) : 120) * 1000;
const argsIndex = args.indexOf("--args-file");
const argsFile = argsIndex > 0 ? args[argsIndex + 1] : null;

if (!file) {
  console.error("用法: node tools/capture/cdp-eval.mjs <file.js> [--port 9333] [--args-file <json>]");
  process.exit(1);
}
const source = readFileSync(file, "utf8");
const injected = argsFile && existsSync(argsFile) ? readFileSync(argsFile, "utf8") : "{}";
const expression = `(async () => {\n`
  + `globalThis.__AG_ARGS__ = ${JSON.stringify(injected)};\n`
  + `const __src = ${JSON.stringify(source)};\n`
  + `return await eval(__src);\n`
  + `})()`;

async function waitForPage() {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < 30000) {
    try {
      const list = await probeTargets(port);
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page;
      last = `${list.length} targets, none is a page`;
    } catch (error) {
      last = String(error.message);
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`找不到可用的页面目标：${last}`);
}

const page = await waitForPage();
const socket = new WebSocket(page.webSocketDebuggerUrl);
const pending = new Map();
let nextId = 1;

const opened = new Promise((resolve, reject) => {
  socket.addEventListener("open", () => resolve());
  socket.addEventListener("error", (event) => reject(new Error(String(event.message ?? "ws error"))));
});

socket.addEventListener("message", (event) => {
  let data;
  try { data = JSON.parse(String(event.data)); } catch { return; }
  if (data.id && pending.has(data.id)) {
    const entry = pending.get(data.id);
    pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.error) entry.reject(new Error(JSON.stringify(data.error)));
    else entry.resolve(data.result);
  }
});

function send(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    // The timer must not keep the process alive after the call settles: a batch
    // that issues dozens of calls would otherwise wait out the last timeout.
    const timer = setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`timeout ${method}`));
    }, timeoutMs);
    timer.unref?.();
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

await opened;
await send("Runtime.enable", {});
let result;
try {
  result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
} catch (error) {
  // Giving up on the socket does not stop the expression: the renderer keeps
  // running it, which is how a timed-out capture used to scroll the app for
  // minutes after the batch had exited. Ask V8 to stop whatever is executing.
  try {
    await Promise.race([
      send("Runtime.terminateExecution", {}),
      new Promise((_, reject) => setTimeout(() => reject(new Error("abort timeout")), 2500))
    ]);
  } catch { /* the socket may already be gone; the in-page deadline is the fallback */ }
  socket.close();
  process.exit(3);
}

if (result.exceptionDetails) {
  const detail = result.exceptionDetails;
  const text = detail.exception?.description ?? detail.text ?? "unknown error";
  console.error(`ERR ${text}`);
  socket.close();
  process.exit(2);
}

const value = result.result?.value;
process.stdout.write(`${typeof value === "string" ? value : JSON.stringify(value)}\n`);
socket.close();
