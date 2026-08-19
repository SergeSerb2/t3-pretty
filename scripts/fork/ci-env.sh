#!/usr/bin/env bash
# Shared path for the importer env file (PATH + cluster secrets).
# Never write it under GITHUB_WORKSPACE: macos-release reuses that tree
# and eas/local packs can pick the file up. Prefer RUNNER_TEMP, then
# TMPDIR, then /tmp.
t3_ci_env_path() {
  local dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"
  dir="${dir%/}"
  local file="${dir}/t3-pretty-ci.env"
  local workspace="${GITHUB_WORKSPACE:-}"
  if [[ -n "$workspace" ]]; then
    workspace="${workspace%/}"
    case "$file" in
      "$workspace"|"$workspace"/*)
        echo "refusing to write $file under GITHUB_WORKSPACE" >&2
        return 1
        ;;
    esac
  fi
  printf '%s\n' "$file"
}
