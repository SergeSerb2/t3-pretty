#!/bin/bash
# Clone this Origin repo into the current directory using the macos-release
# git-credentials store. Buildkite's GitHub Actions checkout adapter does
# not inherit that store on self-hosted Macs, so Mac jobs call this instead
# of actions/checkout.
set -euo pipefail

ref="${1:?checkout-origin.sh: missing git ref}"
full=0
if [[ "${2:-}" == "--full" ]]; then
  full=1
fi

store=""
for candidate in \
  "${HOME}/.git-credentials" \
  /opt/homebrew/var/buildkite-agent/.git-credentials; do
  if [[ -s "$candidate" ]]; then
    store="$candidate"
    break
  fi
done
if [[ -z "$store" ]]; then
  echo "Missing Origin git-credentials store on this macos-release agent." >&2
  exit 1
fi

git_auth=(
  -c credential.helper=
  -c credential.https://origin.cursor.com.helper="store --file=$store"
  -c credential.https://origin.cursor.com/git.helper="store --file=$store"
)
export GIT_TERMINAL_PROMPT=0
url="https://origin.cursor.com/serbinenko/t3-pretty.git"

if [[ ! -d .git ]]; then
  git init
fi
if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$url"
else
  git remote add origin "$url"
fi

fetch_args=(--force)
if [[ "$full" -eq 0 ]]; then
  fetch_args+=(--depth 1)
fi
git "${git_auth[@]}" fetch "${fetch_args[@]}" origin "$ref"
git "${git_auth[@]}" -c advice.detachedHead=false checkout --force FETCH_HEAD
echo "Checked out $ref from Origin"
