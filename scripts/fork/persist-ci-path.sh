#!/usr/bin/env bash
# Prepend directories onto PATH for later GitHub Actions / Buildkite importer
# steps. The importer sometimes sets GITHUB_PATH without applying it, so also
# write PATH to GITHUB_ENV whenever that file exists.
#
# Source this file (`. path/persist-ci-path.sh dir`) so `export PATH` applies
# to the current step. `bash persist-ci-path.sh` only updates the child.
if [[ "${BASH_SOURCE[0]-}" == "${0-}" ]]; then
  set -euo pipefail
fi

_t3_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-env.sh
. "${_t3_here}/ci-env.sh"
unset _t3_here

if [[ $# -lt 1 ]]; then
  echo "persist-ci-path.sh: need at least one directory" >&2
  exit 1
fi

prepend=""
for dir in "$@"; do
  [[ -n "$dir" ]] || continue
  prepend="${prepend:+$prepend:}$dir"
done
test -n "$prepend"
export PATH="${prepend}:${PATH}"

ci_env="$(t3_ci_env_path)"
mkdir -p "$(dirname "$ci_env")"
if [[ -f "$ci_env" ]]; then
  grep -v '^export PATH=' "$ci_env" > "${ci_env}.tmp" || true
  mv "${ci_env}.tmp" "$ci_env"
fi
printf 'export PATH=%q\n' "$PATH" >> "$ci_env"

if [[ -n "${GITHUB_PATH:-}" ]]; then
  for dir in "$@"; do
    [[ -n "$dir" ]] || continue
    echo "$dir" >> "$GITHUB_PATH"
  done
fi
if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "PATH=${PATH}" >> "$GITHUB_ENV"
fi
