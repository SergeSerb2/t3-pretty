#!/bin/bash
# Point the macos-release agent user at a file store for Origin HTTPS.
# Buildkite's GitHub Actions checkout adapter still will not use this;
# Mac jobs clone through scripts/fork/checkout-origin.sh.
set -euo pipefail

store="${ORIGIN_GIT_CREDENTIALS:-$HOME/.git-credentials}"
if [[ ! -f "$store" ]]; then
  echo "Missing $store. Write an Origin HTTPS store (x-access-token JWT) first." >&2
  exit 1
fi

chmod 600 "$store"
for hostName in \
  "https://origin.cursor.com" \
  "https://origin.cursor.com/git"; do
  git config --global --unset-all "credential.${hostName}.helper" >/dev/null 2>&1 || true
  git config --global "credential.${hostName}.helper" ""
  git config --global --add "credential.${hostName}.helper" "store --file=$store"
done
echo "Origin git store helper ready"
