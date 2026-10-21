#!/bin/zsh
set -eu
ptp_script_dir="${0:A:h}"
if command -v node >/dev/null 2>&1; then
  ptp_node="$(command -v node)"
elif [[ -x "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" ]]; then
  ptp_node="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
else
  print -u2 'Node.js 22以降が必要です。'
  exit 1
fi
exec "$ptp_node" "$ptp_script_dir/serve.mjs"
