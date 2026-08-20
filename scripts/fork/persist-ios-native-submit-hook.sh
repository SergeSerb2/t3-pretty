#!/bin/bash
# Copy the macos-release TestFlight submit marker between this checkout and
# the runner cache. Queued ios-mobile jobs check out older SHAs that do not
# contain .t3-fork/ios-native-submit yet; without this they each compile
# another 50–90 minute IPA on the only Mac. Only that copy is ios-mobile.
# Also refresh agent hooks from this checkout so pre-checkout fixes land
# without re-running setup-buildkite-macos-agent.sh.
set -euo pipefail

refresh_macos_agent_hooks() {
  local src hooks
  [[ -n "${BUILDKITE_AGENT_NAME:-}" ]] || return 0
  src="${BUILDKITE_BUILD_CHECKOUT_PATH:-$(pwd)}/scripts/fork"
  hooks="/opt/homebrew/etc/buildkite-agent/hooks"
  [[ -d "$hooks" ]] || return 0
  if [[ -f "$src/macos-origin-git.sh" && -f "$hooks/pre-checkout" ]] \
    && grep -q "Origin git store helper" "$hooks/pre-checkout"; then
    install -m 0755 "$src/macos-origin-git.sh" "$hooks/pre-checkout"
  fi
  if [[ -f "$src/persist-ios-native-submit-hook.sh" && -f "$hooks/post-checkout" ]] \
    && grep -q "ios-native-submit" "$hooks/post-checkout"; then
    install -m 0755 "$src/persist-ios-native-submit-hook.sh" "$hooks/post-checkout"
    install -m 0755 "$src/persist-ios-native-submit-hook.sh" "$hooks/pre-exit"
  fi
}
refresh_macos_agent_hooks

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
