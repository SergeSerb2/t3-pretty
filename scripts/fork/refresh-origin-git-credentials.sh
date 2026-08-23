#!/bin/bash
# Re-mint the Origin HTTPS git credential for the macos-release Buildkite
# agent. Origin git JWTs live about an hour, and a 401 makes git erase the
# whole credential store (one bad fetch wipes every later job). The agent's
# pre-checkout hook points git at a store file, so that file must be
# re-minted well inside the JWT lifetime. Installed as a launchd periodic
# job by setup-buildkite-macos-agent.sh; can also be run by hand.
set -euo pipefail
umask 077

cred="$(printf 'protocol=https\nhost=origin.cursor.com\n\n' | "$HOME/.local/bin/origin" credential-helper get)"
user="$(printf '%s\n' "$cred" | sed -n 's/^username=//p')"
pass="$(printf '%s\n' "$cred" | sed -n 's/^password=//p')"
if [[ -z "$user" || -z "$pass" ]]; then
  echo "$(date): origin credential-helper returned no credential" >&2
  exit 1
fi

# Atomic replace: concurrent agent fetches must never see a partial file.
# Mint through `git credential approve` against a private store so the
# on-disk line carries git's own userinfo percent-encoding (raw userinfo
# breaks the store on ':' or '@' in the JWT), then move it into place.
# mktemp keeps overlapping launchd runs from sharing one tmp path.
tmp="$(mktemp "$HOME/.git-credentials.refresh-tmp.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
rm -f "$tmp"
printf 'protocol=https\nhost=origin.cursor.com\nusername=%s\npassword=%s\n\n' "$user" "$pass" \
  | git -c credential.helper= -c credential.helper="store --file=$tmp" credential approve
mv "$tmp" "$HOME/.git-credentials"
echo "$(date): refreshed Origin git credential store"
