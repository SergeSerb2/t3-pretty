#!/usr/bin/env bash
# Focused scenery motion unit gate. The full web unit project still includes
# sceneryDomContract, which can be red on main for unrelated markup drift.
# This target is the motion contract silent hook-renames break, plus the
# reveal helpers that decide which rows a fold open may tag.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# The `unit` project is defined in apps/web. Running from the repo root
# reports "No projects matched the filter" and never executes the contract.
cd "$ROOT/apps/web"

vp test run --project unit \
  src/scenery/sceneryMotionContract.test.ts \
  src/scenery/sceneryMotionReveals.test.ts \
  src/scenery/sceneryMotionRowArrivals.test.ts \
  src/scenery/sceneryMotionMutations.test.ts \
  src/scenery/useInPlaceChange.test.tsx
