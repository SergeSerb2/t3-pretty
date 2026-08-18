#!/usr/bin/env bash
# Run Origin PR review scripts from origin/main when they exist there.
# A feature-branch edit of review-origin-pr-ci.sh then cannot run on
# macos-release. The first merge uses this checkout as a fallback.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FILES=(
  review-origin-pr-ci.sh
  review-origin-pr.mjs
  check-origin-pr-comments.mjs
  origin-forge.mjs
)

copy_from_main() {
  git -C "$ROOT" fetch --depth=1 origin main
  git -C "$ROOT" cat-file -e origin/main:scripts/fork/review-origin-pr-ci.sh
  local dir="$1"
  local name
  for name in "${FILES[@]}"; do
    git -C "$ROOT" show "origin/main:scripts/fork/${name}" > "${dir}/${name}"
  done
  chmod +x "${dir}/review-origin-pr-ci.sh"
}

DIR="$(mktemp -d)"
if copy_from_main "$DIR" 2>/dev/null; then
  echo "Running Origin PR review scripts from origin/main"
  bash "${DIR}/review-origin-pr-ci.sh" "$@"
else
  echo "origin/main has no review scripts yet; using this checkout"
  bash "${ROOT}/scripts/fork/review-origin-pr-ci.sh" "$@"
fi
