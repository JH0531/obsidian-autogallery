#!/usr/bin/env node
// Shared constants for the winapp capture layer.
//
// Everything here was measured, not assumed:
//  * winapp reports and accepts physical screen pixels (inspect output:
//    coordinateSpace = "physical-screen-pixels", scale = 1.25).
//  * The renderer runs at devicePixelRatio 1.25 on this machine, so one CSS
//    pixel is 1.25 physical pixels. Calibration measures the real factor
//    instead of trusting that number.

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { resolveVault } from "../lib/vault.mjs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const VAULT = resolveVault();
export const TOOLS = resolve(VAULT, ".tools");
export const CACHE = join(VAULT, ".cache", "winapp");
export const STATE = join(CACHE, "state");

export const CDP_PORT = Number(process.env.CDP_PORT || 9333);

// winapp 0.7.1 is on PATH through the WindowsApps alias.
export const WINAPP = "winapp.exe";
export const AHK = "C:\\Program Files\\AutoHotkey\\v2\\AutoHotkey64.exe";

// One workflow id per capture run. `record` with no id owns the desktop for its
// whole duration and blocks every other command; with a shared id the clicks
// interleave with the recording, which is the only way to film a gesture.
export function workflowId() {
  return process.env.WINAPP_UI_WORKFLOW_ID || "";
}
