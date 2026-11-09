#!/bin/bash
# Run one page-side capture script inside the demo vault's Obsidian renderer.
#
#   bash tools/capture/run.sh stage.js
#   bash tools/capture/run.sh shoot.js --args .ag-args.json
#
# Arguments for the script come from .ag-args.json in the vault root, which the
# caller writes first. Output is whatever the snippet returns (JSON, usually).
#
# Everything goes through the DevTools port: it needs no per-command discovery,
# returns the snippet's value verbatim, and — unlike the CLI — does not answer
# "unable to find Obsidian" with exit code 0.
set -e
TOOLS="$(cd "$(dirname "$0")" && pwd)"
VAULT="${AG_VAULT:-$(node "$TOOLS/lib/print-vault.mjs")}"
export VAULT

SCRIPT="${1:?用法: bash tools/capture/run.sh <script.js> [--args <file>]}"
shift || true
RESOLVED=""
for candidate in "$SCRIPT" "$TOOLS/$SCRIPT" "$VAULT/$SCRIPT"; do
  if [ -f "$candidate" ]; then RESOLVED="$candidate"; break; fi
done
[ -n "$RESOLVED" ] || { echo "找不到脚本：$SCRIPT" >&2; exit 1; }

cd "$VAULT"
bash "$TOOLS/ensure-obsidian.sh"
node "$TOOLS/cdp-eval.mjs" "$RESOLVED" --port "${CDP_PORT:-9333}" --args-file "${1:-.ag-args.json}"
