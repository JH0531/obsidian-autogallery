#!/bin/bash
# Run the official Obsidian CLI and fail loudly when it cannot reach the app.
#
#   bash tools/capture/cli.sh eval code="app.vault.getName()"
#   bash tools/capture/cli.sh file path=README.md
#
# Why a wrapper: when the app is not running the CLI prints
#
#   The CLI is unable to find Obsidian. Please make sure Obsidian is running and try again.
#
# and still exits 0. A caller that only looks at $? believes the command worked
# and goes on to parse an empty result. This turns that line into exit 1.
set -uo pipefail
VAULT="${AG_VAULT:-obsidian-autogallery-demo}"
CLI="/c/Program Files/Obsidian/Obsidian.com"

out="$("$CLI" vault="$VAULT" "$@" 2>&1)"
status=$?

# The CLI reports three different failures this way, all with exit code 0:
# the app is not running, the named vault is unknown, and the command itself is
# wrong. Anything else it prints is data.
if printf '%s' "$out" | grep -qE "unable to find Obsidian|^Vault not found\.$|^Error: "; then
  echo "$out" >&2
  echo "（命令未执行，见上面的 CLI 原文）" >&2
  exit 1
fi

printf '%s\n' "$out"
exit "$status"
