#!/usr/bin/env bash
# Load named Buildkite cluster secrets into GITHUB_ENV when they are unset.
#
# The GitHub Actions importer resolves every `secrets.*` reference in a job
# before any step runs. One failed `secret get` (common on hosted Linux for
# some keys) kills the job. Workflows that run on linux-small should read
# `env.NAME` and call this after checkout instead.
set -euo pipefail

if [[ -z "${GITHUB_ENV:-}" ]]; then
  echo "GITHUB_ENV is required." >&2
  exit 1
fi

if ! command -v buildkite-agent >/dev/null; then
  echo "buildkite-agent is not on PATH; leaving existing environment in place."
  exit 0
fi

for name in "$@"; do
  if [[ -n "${!name:-}" ]]; then
    continue
  fi
  if ! value="$(buildkite-agent secret get "$name" 2>/dev/null)"; then
    echo "cluster secret $name is not available on this agent"
    continue
  fi
  {
    printf '%s<<__T3_BK_SECRET_EOF__\n' "$name"
    printf '%s\n' "$value"
    printf '__T3_BK_SECRET_EOF__\n'
  } >> "$GITHUB_ENV"
done
