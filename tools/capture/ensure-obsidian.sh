#!/bin/bash
# Make sure Obsidian is running with the DevTools port open.
#
#   bash tools/capture/ensure-obsidian.sh
#
# Two facts this script exists to handle (measured 2026-11-07):
#
#  * A process started inside a capture call is reaped when that call ends. That
#    is fine — the caller starts the app, uses it and lets it go within the same
#    call. Do not expect the app to outlive the call.
#  * An app started *without* `--remote-debugging-port` cannot be given the port
#    retroactively: launching a second copy only focuses the first one. Detect
#    that case and say so instead of retrying for 40 seconds.
set -e
PORT="${CDP_PORT:-9333}"
EXE="/c/Program Files/Obsidian/Obsidian.exe"

probe() {
  curl -s --noproxy '*' --max-time 2 "http://127.0.0.1:${PORT}/json/list" >/dev/null 2>&1
}

running() {
  [ "$(tasklist //FO CSV 2>/dev/null | grep -ci 'obsidian.exe')" -gt 0 ]
}

if probe; then exit 0; fi

if running; then
  echo "Obsidian 正在运行，但没有打开调试端口 ${PORT}。" >&2
  echo "它是被无参数启动的：先完全退出（taskkill //IM Obsidian.exe //F），再重新运行本脚本。" >&2
  exit 1
fi

# A vault can be passed explicitly. The capture targets live inside this repo
# (`demo/`, `demo-en/`); without the argument Obsidian reopens whichever vault
# it used last, which is how a run silently writes media into the wrong tree.
VAULT_ARG=""
WINDOW_STYLE=""
if [ "${AG_BACKGROUND:-0}" = "1" ]; then
  WINDOW_STYLE="-WindowStyle Minimized"
fi
if [ -n "${AG_OPEN_VAULT:-}" ]; then
  VAULT_ARG="$(cygpath -w "$AG_OPEN_VAULT" 2>/dev/null || printf '%s' "$AG_OPEN_VAULT")"
  powershell -NoProfile -Command "Start-Process -FilePath 'C:\\Program Files\\Obsidian\\Obsidian.exe' ${WINDOW_STYLE} -ArgumentList '--remote-debugging-port=${PORT}','${VAULT_ARG}'" >/dev/null 2>&1
else
  powershell -NoProfile -Command "Start-Process -FilePath 'C:\\Program Files\\Obsidian\\Obsidian.exe' ${WINDOW_STYLE} -ArgumentList '--remote-debugging-port=${PORT}'" >/dev/null 2>&1
fi

for _ in $(seq 1 40); do
  sleep 1
  if probe; then exit 0; fi
done

echo "CDP 端口 ${PORT} 未就绪：Obsidian 可能未启动或已退出" >&2
exit 1
