#!/bin/bash
# Re-mint the Origin HTTPS git credential for the macos-release Buildkite
# agent. Origin git JWTs live about an hour, and a 401 makes git erase the
# whole credential store (one bad fetch wipes every later job). The agent's
# pre-checkout hook points git at a store file, so that file must be
# re-minted well inside the JWT lifetime. Installed as a launchd periodic
# job by setup-buildkite-macos-agent.sh; can also be run by hand.
set -euo pipefail

cred="$(printf 'protocol=https\nhost=origin.cursor.com\n\n' | "$HOME/.local/bin/origin" credential-helper get)"
user="$(printf '%s\n' "$cred" | sed -n 's/^username=//p')"
pass="$(printf '%s\n' "$cred" | sed -n 's/^password=//p')"
if [[ -z "$user" || -z "$pass" ]]; then
  echo "$(date): origin credential-helper returned no credential" >&2
  exit 1
fi

# Atomic replace: concurrent agent fetches must never see a partial file.
tmp="$HOME/.git-credentials.refresh-tmp"
printf 'https://%s:%s@origin.cursor.com\n' "$user" "$pass" > "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$HOME/.git-credentials"
echo "$(date): refreshed Origin git credential store"
