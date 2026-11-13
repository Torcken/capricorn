#!/usr/bin/env sh
# Copyright (C) 2026 Guillaume S. Condamine & all awesome contributors.
# SPDX-License-Identifier: Apache-2.0
#
# Starts Capricorn from this source checkout.
#
#   ./start.sh                 interactive session in the current directory
#   ./start.sh -p "question"   headless run
#   ./start.sh doctor --load   any other Capricorn arguments
#
# What it does, and nothing more:
#   1. checks Node.js (>= 20) and that dependencies are installed;
#   2. rebuilds the bundle locally if the sources are newer than it;
#   3. checks that the local Ollama daemon answers;
#   4. runs Capricorn with your arguments, in the directory you started from.
#
# Security: it never installs, downloads or pulls anything (it tells you what
# to run instead), never uses sudo, and only contacts the Ollama endpoint when
# that endpoint is on this machine. Capricorn itself enforces its network,
# model and approval policies; this script does not change any of them.

set -eu

REPO_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
BUNDLE="$REPO_DIR/bundle/capricorn.js"
OLLAMA_URL=${CAPRICORN_OLLAMA_HOST:-http://127.0.0.1:11434}

die() {
  printf 'start.sh: %s\n' "$1" >&2
  exit 1
}

# 1. Node.js and dependencies -------------------------------------------------
command -v node >/dev/null 2>&1 ||
  die 'Node.js is not installed. Install Node.js 20 or newer.'
node_major=$(node -p 'process.versions.node.split(".")[0]')
[ "$node_major" -ge 20 ] ||
  die "Node.js $(node --version) is too old; Capricorn needs 20 or newer."
[ -d "$REPO_DIR/node_modules" ] ||
  die "dependencies are missing. Run once:  (cd '$REPO_DIR' && npm ci)"

# 2. Bundle: build when missing or older than any source file -----------------
stale=''
if [ ! -f "$BUNDLE" ]; then
  stale='missing'
elif [ -n "$(find "$REPO_DIR/packages/core/src" "$REPO_DIR/packages/cli/src" \
  -type f -newer "$BUNDLE" -print 2>/dev/null | head -n 1)" ]; then
  stale='out of date'
fi
if [ -n "$stale" ]; then
  printf 'start.sh: bundle %s, building it (local only, ~1 min)...\n' \
    "$stale" >&2
  (cd "$REPO_DIR" && npm run --silent bundle >/dev/null) ||
    die "build failed. Run  (cd '$REPO_DIR' && npm run bundle)  to see why."
fi

# 3. Ollama: probe only a local endpoint ---------------------------------------
case "$OLLAMA_URL" in
http://127.0.0.1:* | http://127.0.0.1 | http://localhost:* | http://localhost | http://\[::1\]:* | http://\[::1\])
  if command -v curl >/dev/null 2>&1 &&
    ! curl -fsS --max-time 3 --noproxy '*' "$OLLAMA_URL/api/version" \
      >/dev/null 2>&1; then
    die "Ollama is not answering at $OLLAMA_URL. Start it with:  ollama serve"
  fi
  ;;
*)
  # Not on this machine: no probe from here. Capricorn refuses remote
  # endpoints unless the user explicitly allowed them in user settings.
  ;;
esac

# 4. Run -------------------------------------------------------------------------
exec node "$BUNDLE" "$@"
