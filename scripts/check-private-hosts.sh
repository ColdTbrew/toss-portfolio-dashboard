#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

# Shared with tests/privateHosts.test.ts; keep this a single-quoted ERE.
PRIVATE_HOST_PATTERN='\b100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\.(25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])\b|\b([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+ts\.net\b'

if matches=$(git grep --no-color -nIE -i -e "$PRIVATE_HOST_PATTERN" -- .); then
  printf '%s\n' 'Tailscale 비공개 주소가 추적 파일에 있습니다. 실제 주소는 레포 밖의 환경 파일에 보관하세요:' >&2
  # Report locations without echoing private addresses or the rest of the line.
  printf '%s\n' "$matches" | cut -d: -f1,2 >&2
  exit 1
else
  status=$?
  if [[ $status -ne 1 ]]; then
    printf '%s\n' '비공개 주소 검사를 실행하지 못했습니다.' >&2
    exit "$status"
  fi
fi
