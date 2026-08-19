#!/bin/bash
# Copy the macos-release TestFlight submit marker between this checkout and
# the runner cache. Queued ios-mobile jobs check out older SHAs that do not
# contain .t3-fork/ios-native-submit yet; without this they each compile
# another 50–90 minute IPA on the only Mac. Only runs for that step.
set -euo pipefail

[[ "${BUILDKITE_STEP_KEY:-}" == "ios-mobile" ]] || exit 0

cache="${HOME}/.cache/t3-pretty-release/ios-native-submit"
repo=".t3-fork/ios-native-submit"
mkdir -p "$(dirname "$cache")" .t3-fork

if [[ -f "$repo" ]]; then
  first="$(head -n 1 "$repo" | tr -d '[:space:]')"
  if [[ "$first" == "macos-release" ]]; then
    cp "$repo" "$cache"
  fi
fi

if [[ -f "$cache" ]]; then
  first="$(head -n 1 "$cache" | tr -d '[:space:]')"
  if [[ "$first" == "macos-release" ]]; then
    cp "$cache" "$repo"
  fi
fi
