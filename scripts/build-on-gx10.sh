#!/usr/bin/env bash
set -euo pipefail
export PATH="$HOME/.local/opt/node24/bin:$PATH"
cd "$HOME/apps/toss-portfolio-dashboard"
if [[ $(node -p 'process.versions.node.split(".")[0]') != 24 ]]; then
  printf '%s\n' 'Node 24가 필요합니다.' >&2
  exit 1
fi
export TOSS_MOCK=1
npm ci
npm run build
