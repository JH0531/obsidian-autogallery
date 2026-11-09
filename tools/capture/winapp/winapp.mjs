#!/usr/bin/env node
// Thin wrapper around the winapp CLI.
//
// winapp 0.7.1 prints {"error":{...}} on failure but still exits 0, so the exit
// code alone cannot be trusted. Every call goes through here and is judged by
// the parsed payload.

import { spawn } from "node:child_process";
import { WINAPP, workflowId } from "./env.mjs";

export function runWinapp(args, { timeoutMs = 20000, allowError = false } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    const id = workflowId();
    if (id) env.WINAPP_UI_WORKFLOW_ID = id;

    const child = spawn(WINAPP, args, { env, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch {}
      resolve({ ok: false, code: "timeout", message: `winapp 超时 ${timeoutMs}ms: ${args.join(" ")}`, stdout, stderr });
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on("data", (b) => { stdout += b; });
    child.stderr.on("data", (b) => { stderr += b; });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: "spawn", message: String(error.message), stdout, stderr });
    });
    child.on("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      let data = null;
      const text = stdout.trim();
      if (text.startsWith("{") || text.startsWith("[")) {
        try { data = JSON.parse(text); } catch {}
      }
      const errCode = data && data.error && (data.error.code || data.error.Code);
      if (errCode && !allowError) {
        return resolve({ ok: false, code: errCode, message: data.error.message || "", data, stdout, stderr, exitCode });
      }
      resolve({ ok: true, code: exitCode, data, stdout, stderr });
    });
  });
}

// Errors that mean "the desktop was busy", not "the request was wrong".
export const RETRYABLE = new Set(["foreground_not_target", "target_moved", "ui_turn_busy", "queue_capacity_exceeded"]);

export async function withRetry(label, fn, { attempts = 3, delayMs = 250 } = {}) {
  let last;
  for (let i = 1; i <= attempts; i++) {
    last = await fn(i);
    if (last.ok) return last;
    if (!RETRYABLE.has(last.code)) return last;
    if (i < attempts) await new Promise((r) => setTimeout(r, delayMs * i));
  }
  return last;
}
