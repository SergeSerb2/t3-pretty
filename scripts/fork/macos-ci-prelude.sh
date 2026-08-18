#!/usr/bin/env bash
# Source at the start of macos-release GHA-importer steps.
# The importer often omits GITHUB_PATH / GITHUB_ENV, so PATH and secrets
# persist through this file instead.
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:${HOME}/.vite-plus/bin:${HOME}/.local/bin:${PATH}"
_t3_ci_env="${RUNNER_TEMP:-${GITHUB_WORKSPACE:-${HOME}}}/t3-pretty-ci.env"
if [[ -f "$_t3_ci_env" ]]; then
  # shellcheck disable=SC1090
  . "$_t3_ci_env"
fi
unset _t3_ci_env
