#!/usr/bin/env bash
set -euo pipefail
if [[ $# -gt 1 || ( $# -eq 1 && $1 != --start ) ]]; then
  printf '%s\n' '사용법: scripts/install-service.sh [--start]' >&2
  exit 1
fi
cd "$(dirname "${BASH_SOURCE[0]}")/.."
install -d -m 700 "$HOME/.config/systemd/user"
install -m 644 deploy/toss-dashboard.service "$HOME/.config/systemd/user/toss-dashboard.service"
if [[ ! -e "$HOME/.config/toss-dashboard.env" ]]; then
  install -m 600 deploy/toss-dashboard.env.example "$HOME/.config/toss-dashboard.env"
fi
systemctl --user daemon-reload
printf '%s\n' '설치 완료. 설정을 확인한 뒤 실행하세요:' 'systemctl --user enable --now toss-dashboard'
if [[ ${1:-} == --start ]]; then
  systemctl --user enable --now toss-dashboard
fi
