#!/usr/bin/env bash
# Shared path for the importer env file (PATH + cluster secrets).
# Prefer RUNNER_TEMP even when that directory lives under GITHUB_WORKSPACE
# (the GHA importer sets RUNNER_TEMP to a _temp sibling of the checkout).
# Only avoid the workspace *root*, which eas local can pack. Never use HOME.
t3_ci_env_path() {
  local dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
  dir="${dir%/}"
  local workspace="${GITHUB_WORKSPACE:-}"
  workspace="${workspace%/}"
  if [[ -n "$workspace" && "$dir" == "$workspace" ]]; then
    echo "RUNNER_TEMP is the workspace root; writing t3-pretty-ci.env under /tmp" >&2
    dir="/tmp"
  fi
  printf '%s\n' "${dir}/t3-pretty-ci.env"
}
