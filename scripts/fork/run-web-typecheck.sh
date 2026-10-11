#!/usr/bin/env bash
# PR-gate for the apps/web typecheck. Packaging (windows-nsis, macos-dmg,
# linux-appimage) runs `vp build` of apps/web and fails on missing rolldown
# exports; PR builds skip packaging, and tsc is the cheap way to catch the
# same drift before a sync lands. No packaging, no EAS, no Relay.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# shellcheck source=ensure-vite-plus.sh
source "$ROOT/scripts/fork/ensure-vite-plus.sh"
ensure_vite_plus "to typecheck the web app" || exit 1

vp i --frozen-lockfile --filter @t3tools/web...
vp run --filter @t3tools/web typecheck
