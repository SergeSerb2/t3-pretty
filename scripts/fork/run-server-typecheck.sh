#!/usr/bin/env bash
# PR-gate for the apps/server and packaging-scripts typechecks. The nightly
# sync already installs and can call the same `vp` commands; this script
# exists so a feature-branch Buildkite step can install the server graph and
# fail the PR without packaging, EAS, or Relay.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# shellcheck source=ensure-vite-plus.sh
source "$ROOT/scripts/fork/ensure-vite-plus.sh"
ensure_vite_plus "to typecheck the server" || exit 1

# apps/server/tsconfig.json includes ../../scripts/lib, so the scripts
# workspace must be installed too. Skip mobile/desktop/marketing.
# scripts/lib is not enough: build-desktop-artifact.ts lives at the scripts
# package root and is only typechecked by @t3tools/scripts.
vp i --frozen-lockfile --filter t3... --filter @t3tools/scripts...
vp run --filter t3 typecheck
vp run --filter @t3tools/scripts typecheck
