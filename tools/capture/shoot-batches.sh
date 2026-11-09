#!/bin/bash
# Capture stills in small batches.
#
#   bash tools/capture/shoot-batches.sh [batchSize]
#
# Obsidian on this machine does not survive a long uninterrupted scripted pass,
# so one shot per short process is the reliable unit. shoot-batch.mjs already
# enforces a per-shot deadline; this script just keeps the passes small and
# restarts the app between them.
set -u
TOOLS="$(cd "$(dirname "$0")" && pwd)"
VAULT="${AG_VAULT:-$(node "$TOOLS/lib/print-vault.mjs")}"
export VAULT

BATCH="${1:-4}"
IDS=(
  AG-S02-01 AG-S04-01 AG-S04-02 AG-S04-03 AG-S05-01 AG-S05-02 AG-S05-03 AG-S05-04
  AG-S06-01 AG-S06-02 AG-S07-01 AG-S08-01a AG-S08-01b AG-S09-01
  AG-S11-01 AG-S11-02 AG-S12-01 AG-S12-02 AG-S12-03 AG-S13-01 AG-S13-02
  AG-S17-01 AG-S17-02
)
total=${#IDS[@]}
round=0

for ((i = 0; i < total; i += BATCH)); do
  round=$((round + 1))
  slice=("${IDS[@]:i:BATCH}")
  echo "== 第 ${round} 批（$((i + 1))-$(($i + ${#slice[@]}))/${total}）：${slice[*]}"
  for id in "${slice[@]}"; do
    node "$TOOLS/shoot-batch.mjs" --only "$id" --force 2>&1 | tail -3
  done
  sleep 1
done

echo "== 完成：$(ls "$VAULT/.cache/shots" 2>/dev/null | wc -l) 个分块目录"
