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
  value="${!name:-}"
  if [[ -z "$value" ]] && command -v buildkite-agent >/dev/null; then
    value="$(buildkite-agent secret get "$name" 2>/dev/null || true)"
  fi
  if [[ -z "$value" ]]; then
    for candidate in \
      "${HOME}/.config/t3-pretty/${name}" \
      "/Users/m1-dev/.config/t3-pretty/${name}" \
      "/opt/homebrew/var/buildkite-agent/secrets/${name}"; do
      if [[ -f "$candidate" ]]; then
        # Keep PEM newlines (APNs). Strip CRs and one trailing newline.
        value="$(tr -d '\r' < "$candidate")"
        value="${value%$'\n'}"
        break
      fi
    done
  fi
  if [[ -z "$value" ]]; then
    echo "cluster secret $name is not available on this agent"
    continue
  fi
  # Always write GITHUB_ENV, including values interpolated onto this step.
  # Skipping that write leaves later steps (require/deploy) empty.
  {
    printf '%s<<__T3_BK_SECRET_EOF__\n' "$name"
    printf '%s\n' "$value"
    printf '__T3_BK_SECRET_EOF__\n'
  } >> "$GITHUB_ENV"
done
