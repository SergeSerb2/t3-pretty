#!/usr/bin/env bash
# Focused scenery motion unit gate. The full web unit project still includes
# sceneryDomContract, which can be red on main for unrelated markup drift.
# This target is the motion contract silent hook-renames break, plus the
# reveal helpers that decide which rows a fold open may tag.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

vp test run --project unit \
  apps/web/src/scenery/sceneryMotionContract.test.ts \
  apps/web/src/scenery/sceneryMotionReveals.test.ts \
  apps/web/src/scenery/sceneryMotionRowArrivals.test.ts \
  apps/web/src/scenery/sceneryMotionMutations.test.ts
