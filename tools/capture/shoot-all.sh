#!/bin/bash
# DEPRECATED — kept only to stop accidental use.
#
# This entry point launched a CDP capture for every shot in one long-lived
# process. When the caller was interrupted, the CDP socket closed but the loop
# inside the renderer kept running, so the app appeared to "keep pre-warming"
# for minutes. Use the per-figure batch instead, which has a deadline per shot:
#
#   node tools/capture/shoot-batch.mjs              # all eligible stills
#   node tools/capture/shoot-batch.mjs --only AG-S04-01 --force
#   bash tools/capture/shoot-batches.sh 4           # small passes, app restarts between
#
echo "shoot-all.sh 已废弃：请用 node tools/capture/shoot-batch.mjs（单张有 75 秒硬超时）" >&2
exit 1
