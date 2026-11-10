#!/usr/bin/env sh
# Copyright 2026 Capricorn Contributors
# SPDX-License-Identifier: Apache-2.0
#
# Offline/privacy verification (spec §8): runs the end-to-end suite inside a
# fresh network namespace that has only a loopback interface, so any attempt
# by Capricorn (or a dependency) to reach the internet fails at the kernel
# level instead of relying on Capricorn's own egress guard.
#
# Requirements: Linux with unprivileged user namespaces (`unshare -rn`).
# Usage: npm run build && sh scripts/verify-offline.sh
set -eu
if ! command -v unshare >/dev/null 2>&1; then
  echo "unshare not available; offline verification requires Linux user namespaces." >&2
  exit 2
fi
exec unshare -rn sh -c '
  ip link set lo up 2>/dev/null || true
  if curl -s -m 3 https://example.com >/dev/null 2>&1; then
    echo "ERROR: network is reachable inside the namespace; aborting." >&2
    exit 3
  fi
  echo "Network namespace active (loopback only). Running e2e suite..."
  npx vitest run --config e2e/vitest.config.ts
'
