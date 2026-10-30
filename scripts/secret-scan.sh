#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
./scripts/check-private-hosts.sh
if ! command -v gitleaks >/dev/null 2>&1; then
  printf '%s\n' 'gitleaks v8.30.1을 PATH에 준비한 뒤 다시 실행하세요.' >&2
  exit 1
fi
# Scan every branch and commit; the pre-commit hook scans staged changes.
gitleaks git --redact --config .gitleaks.toml --log-opts="--all" .
