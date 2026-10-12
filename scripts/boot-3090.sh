#!/bin/sh
# Boot the acceptance `dsh web` on :3090 (see plan/PROTOCOL.md / AGENTS.md).
# Sources .env.local (never prints keys). Strips session + profile vars so this
# host is not bound to a GUI agent session. cwd = this repo (workspace keying).
#
# Ownership: prefer human boots once; overnight agents REUSE via health curl.
# If restarting is allowed: kill only the verified :3090 pid (ss -ltnp), never
# `pkill dsh` / `pkill node` (that also matches sacred :3080).
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR" || exit 1
if [ ! -f "$DIR/.env.local" ]; then
  echo "boot-3090: missing $DIR/.env.local — copy from .env.local.example" >&2
  exit 1
fi
# shellcheck disable=SC1091
. "$DIR/.env.local"
# LLAMA_API_KEY arms llama-server; dsh stub is LLAMACPP_API_KEY only.
unset LLAMA_API_KEY LLAMA_API_KEY_FILE
exec env -u DSH_WEB_URL -u DSH_SHELL -u DSH_SESSION_ID -u DSH_PROFILE -u DSH_PROFILE_DIR \
  dsh web --port 3090 --no-open
