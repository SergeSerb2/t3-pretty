#!/bin/bash
# pre-command hook. No-op unless this agent opted into review-only mode.
# macos-release still matches old feature-branch pipelines, so a daily-driver
# review Mac must refuse DMG/relay/sync and imported macos GHA children.
# ios-mobile is allowed: Expo cloud OTA/IPA does not need the Mac keychain.
[[ "${T3_PRETTY_REVIEW_ONLY:-}" == "1" ]] || exit 0
case "${BUILDKITE_STEP_KEY:-}" in
  origin-pr-review | origin-pr-comments | ios-mobile) exit 0 ;;
esac
echo "This macos-release agent is review-only. Refusing ${BUILDKITE_STEP_KEY:-unknown}." >&2
exit 1
