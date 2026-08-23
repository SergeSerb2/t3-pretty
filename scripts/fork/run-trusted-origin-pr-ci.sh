#!/usr/bin/env bash
# Run Origin PR review scripts from origin/main when they exist there.
# A feature-branch edit of review-origin-pr-ci.sh then cannot run on
# macos-release. The first merge uses this checkout as a fallback.
set -euo pipefail

# Buildkite sets FORCE_COLOR and NO_COLOR together. Origin's bun CLI then
# prints assertion_error while loading tty colors and, on the macos-release
# agent, can exit 255 from `git fetch` (credential helper) and `origin`.
unset NO_COLOR || true
export FORCE_COLOR="${FORCE_COLOR:-0}"
if [[ "${FORCE_COLOR}" == "1" || "${FORCE_COLOR}" == "true" ]]; then
  export FORCE_COLOR=0
fi
export GIT_TERMINAL_PROMPT=0

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FILES=(
  review-origin-pr-ci.sh
  review-origin-pr.mjs
  check-origin-pr-comments.mjs
  origin-forge.mjs
)

copy_from_main() {
  local dir="$1"
  local name
  local main_ref="refs/t3-pretty/origin-main"
  # Never update origin/main. A shallow fetch of main into that name makes it
  # a root, so `git diff origin/main...HEAD` has no merge-base and exits 128
  # (Buildkite #563). --deepen on the PR checkout does the same when main is
  # not in the shallow PR ancestry (Buildkite #757).
  git -C "$ROOT" fetch --depth=1 origin "refs/heads/main:${main_ref}" \
    || git -C "$ROOT" fetch origin "refs/heads/main:${main_ref}" \
    || return 1
  git -C "$ROOT" cat-file -e "${main_ref}:scripts/fork/review-origin-pr-ci.sh" || return 1
  for name in "${FILES[@]}"; do
    git -C "$ROOT" show "${main_ref}:scripts/fork/${name}" > "${dir}/${name}" || return 1
  done
  chmod +x "${dir}/review-origin-pr-ci.sh"
}

DIR="$(mktemp -d)"
if copy_from_main "$DIR"; then
  echo "Running Origin PR review scripts from origin/main"
  # Same-build comment checks must see this checkout's ignore-current-SHA rule.
  # Review retries live in this checkout's review-origin-pr.mjs; origin/main
  # does not have them yet. Secret loading still comes from origin/main.
  if [[ "${1:-}" == "check" ]]; then
    cp "${ROOT}/scripts/fork/check-origin-pr-comments.mjs" "${DIR}/check-origin-pr-comments.mjs"
    echo "Using checkout comment-resolution check"
  else
    cp "${ROOT}/scripts/fork/review-origin-pr.mjs" "${DIR}/review-origin-pr.mjs"
    echo "Using checkout Origin PR review"
  fi
  bash "${DIR}/review-origin-pr-ci.sh" "$@"
else
  echo "origin/main has no review scripts yet; using this checkout"
  bash "${ROOT}/scripts/fork/review-origin-pr-ci.sh" "$@"
fi
