#!/usr/bin/env node
// Evaluate snippets inside the Obsidian renderer over the DevTools protocol.
//
// The DevTools endpoint is loopback-only. Undici's fetch honours the machine's
// HTTP_PROXY and answers ECONNREFUSED for it, which looks exactly like
// "Obsidian is not running" — so this uses plain http.request.

import { request } from "node:http";
import { CDP_PORT } from "./env.mjs";

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

export async function listPages(port = CDP_PORT) {
  const list = await probeTargets(port);
  return list.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

// Settings open in their own window on this build, so "the page" is ambiguous.
// Prefer the target that actually has the Obsidian API on it.
export async function waitForPage(port = CDP_PORT, timeoutMs = 20000) {
  const start = Date.now();
  let last = "";
  while (Date.now() - start < timeoutMs) {
    try {
      const list = (await probeTargets(port)).filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (list.length) {
        // The app:// URL is the note window; about:blank is a settings window.
        const byUrl = list.find((t) => String(t.url || "").includes("app://obsidian.md"));
        if (byUrl) return byUrl;
        for (const page of list) {
          try {
            const hasApp = await evalAt(page.webSocketDebuggerUrl, "return typeof app !== 'undefined';", { timeoutMs: 1500 });
            if (hasApp) return page;
          } catch {}
        }
        return list[0];
      }
      last = `${list.length} targets, none is a page`;
    } catch (error) {
      last = String(error.message);
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error(`CDP 不可用（${last}）：Obsidian 需要以 --remote-debugging-port=${port} 启动`);
}

// Run a body in one specific target. Settings live in their own window, so the
// caller sometimes has to say which window it means.
export async function evalAt(wsUrl, body, { timeoutMs = 15000 } = {}) {
  const socket = new WebSocket(wsUrl);
  const pending = new Map();
  let nextId = 1;

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", (event) => reject(new Error(String(event.message ?? "ws error"))), { once: true });
  });

  socket.addEventListener("message", (event) => {
    let data;
    try { data = JSON.parse(String(event.data)); } catch { return; }
    if (!data.id || !pending.has(data.id)) return;
    const entry = pending.get(data.id);
    pending.delete(data.id);
    clearTimeout(entry.timer);
    if (data.error) entry.reject(new Error(JSON.stringify(data.error)));
    else entry.resolve(data.result);
  });

  function send(method, params) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
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

  try {
    const result = await send("Runtime.evaluate", {
      expression: `(async () => {\n${body}\n})()`,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails;
      throw new Error(detail.exception?.description ?? detail.text ?? "unknown error");
    }
    const value = result.result?.value;
    try { socket.close(); } catch {}
    return value;
  } catch (error) {
    // Giving up on the socket does not stop the renderer. Ask V8 to stop.
    try {
      await Promise.race([
        send("Runtime.terminateExecution", {}),
        new Promise((_, reject) => setTimeout(() => reject(new Error("abort timeout")), 2000))
      ]);
    } catch {}
    try { socket.close(); } catch {}
    throw error;
  }
}

// body is the inside of an async function; it may use await and must return.
export async function pageEval(body, { port = CDP_PORT, timeoutMs = 15000 } = {}) {
  const page = await waitForPage(port);
  return evalAt(page.webSocketDebuggerUrl, body, { timeoutMs });
}

export async function evalFile(path, { port = CDP_PORT, timeoutMs = 15000 } = {}) {
  const { readFileSync } = await import("node:fs");
  return pageEval(readFileSync(path, "utf8"), { port, timeoutMs });
}
