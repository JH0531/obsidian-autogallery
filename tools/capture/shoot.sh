#!/bin/bash
# Capture one still.
#
#   AG_LANG=zh AG_THEME=dark bash tools/capture/shoot.sh <id> <note> [preview|source] [final] [anchor] [heightCss] [extentCss] [startCss]
#
# The still is framed to `extentCss`: sections taller than one viewport are
# captured in chunks and stitched by finish-stills.mjs. Raw chunks land in the
# vault's .cache/shots/<id>--<lang>-<theme>/; `final` only marks the shot as part
# of the batch. Empty `anchor` means "from the top of the note"; `startCss` then
# trims the leading offset (used to skip the H1).
#
# The language and the theme decide which cell of the matrix the frame belongs
# to. They are passed through to shoot.js and recorded in the shot's meta.json;
# the allowed values live in tools/capture/lib/media.mjs, and this guard only
# rejects a typo before it becomes a directory name.
#
# The toolchain lives in the plugin repository; the vault is only a target, so
# every path here is either $TOOLS (code and figure lists) or $VAULT (outputs).
set -e
TOOLS="$(cd "$(dirname "$0")" && pwd)"
VAULT="${AG_VAULT:-$(node "$TOOLS/lib/print-vault.mjs")}"
export VAULT

AG_LANG="${AG_LANG:-zh}"
AG_THEME="${AG_THEME:-dark}"
case "$AG_LANG" in zh|en) ;; *) echo "未知语言 $AG_LANG（可用 zh、en）" >&2; exit 2 ;; esac
case "$AG_THEME" in dark|light) ;; *) echo "未知主题 $AG_THEME（可用 dark、light）" >&2; exit 2 ;; esac
export AG_LANG AG_THEME

ID="$1"
NOTE="$2"
MODE="${3:-preview}"
FINAL="false"
[ "$4" = "final" ] && FINAL="true"
ANCHOR="${5:-}"
HEIGHT="${6:-800}"
EXTENT="${7:-$HEIGHT}"
START="${8:-0}"

cd "$VAULT"
mkdir -p "$TOOLS/out" "$VAULT/.cache/shots"
node -e '
const fs = require("fs");
const [id, note, mode, final, anchor, height, extent, start] = process.argv.slice(1);
const payload = {
  id, note, mode,
  lang: process.env.AG_LANG,
  theme: process.env.AG_THEME,
  final: final === "true",
  heightCss: Number(height) || 800,
  extentCss: Number(extent) || Number(height) || 800,
  startCss: Number(start) || 0
};
if (anchor) payload.anchor = anchor;
fs.writeFileSync(process.env.VAULT + "/.ag-args.json", JSON.stringify(payload));
' "$ID" "$NOTE" "$MODE" "$FINAL" "$ANCHOR" "$HEIGHT" "$EXTENT" "$START"

bash "$TOOLS/ensure-obsidian.sh"
node "$TOOLS/cdp-eval.mjs" "$TOOLS/shoot.js" --port "${CDP_PORT:-9333}" --args-file .ag-args.json
