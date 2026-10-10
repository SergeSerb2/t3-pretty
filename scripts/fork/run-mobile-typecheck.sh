#!/usr/bin/env bash
# PR-gate for the apps/mobile typecheck. The nightly sync already installs
# and can call the same `vp` command; this script exists so a feature-branch
# Buildkite step can install the mobile graph and fail the PR without
# packaging, EAS, or TestFlight. Metro does not typecheck.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

# shellcheck source=ensure-vite-plus.sh
source "$ROOT/scripts/fork/ensure-vite-plus.sh"
ensure_vite_plus "to typecheck mobile" || exit 1

vp i --frozen-lockfile --filter @t3tools/mobile...
vp run --filter @t3tools/mobile typecheck
