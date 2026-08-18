#!/usr/bin/env bash
# Prepend directories onto PATH for later GitHub Actions / Buildkite importer
# steps. The importer sometimes sets GITHUB_PATH without applying it, so also
# write PATH to GITHUB_ENV whenever that file exists.
set -euo pipefail

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

wrote=0
if [[ -n "${GITHUB_PATH:-}" ]]; then
  for dir in "$@"; do
    [[ -n "$dir" ]] || continue
    echo "$dir" >> "$GITHUB_PATH"
  done
  wrote=1
fi
if [[ -n "${GITHUB_ENV:-}" ]]; then
  echo "PATH=${PATH}" >> "$GITHUB_ENV"
  wrote=1
fi
if [[ "$wrote" -eq 0 ]]; then
  echo "Neither GITHUB_PATH nor GITHUB_ENV is set; cannot persist PATH." >&2
  exit 1
fi
