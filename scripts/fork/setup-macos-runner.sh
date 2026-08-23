#!/bin/bash
# Register a trusted macOS runner for T3 Pretty releases.
#
# After the Origin cutover, attach this machine to the Origin Buildkite app
# with the same t3code-fork / release-only labels. This script still knows how
# to register a GitHub Actions runner for rollback only.
#
# This is optional. m5-dev is the packaging Mac: the Buildkite agent builds
# the signed macOS DMG and local iOS IPAs (m1-dev is now Linux). Do not
# register a daily driver until you are willing to share CPU with those jobs.
#
# iOS jobs require a full Xcode.app (stable or beta). Command Line Tools
# cannot compile a TestFlight IPA. Register this host only after Xcode is
# installed, or iOS may land here and fail.
#
# Usage:
#   printf '%s\n' '{"token":"<registration token>"}' > "$HOME/t3-runner-token.json"
#   bash scripts/fork/setup-macos-runner.sh
#
# Create the token at
# https://github.com/SergeSerb2/t3-pretty/settings/actions/runners/new
# (or `gh api -X POST repos/SergeSerb2/t3-pretty/actions/runners/registration-token`).
# The script deletes the token file after it is read.

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/SergeSerb2/t3-pretty}"
RUNNER_NAME="${RUNNER_NAME:-m5-dev-t3code-fork}"
RUNNER_DIR="${RUNNER_DIR:-$HOME/actions-runner-t3code-fork}"
RUNNER_VERSION="${RUNNER_VERSION:-2.336.0}"
RUNNER_SHA256="${RUNNER_SHA256:-8e8839c49b7060b6b2154f4931f815df330c27f167d53ef2239ee3dfce28b079}"
TOKEN_PATH="${TOKEN_PATH:-$HOME/t3-runner-token.json}"
LABELS="${LABELS:-t3code-fork,release-only,macos-arm64}"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This script is for Apple Silicon macOS only." >&2
  exit 1
fi

has_full_xcode=0
for app in /Applications/Xcode.app /Applications/Xcode-beta.app /Applications/Xcode*.app; do
  if [[ -x "$app/Contents/Developer/usr/bin/xcodebuild" ]]; then
    has_full_xcode=1
    echo "Found Xcode at $app"
    break
  fi
done
if (( has_full_xcode == 0 )); then
  echo "No full Xcode.app found. This machine can sign a desktop DMG after" >&2
  echo "Developer ID secrets are present, but it cannot compile an iOS IPA." >&2
  echo "Install Xcode before registering if this host should take iOS jobs." >&2
  if [[ "${ALLOW_NO_XCODE:-}" != "1" ]]; then
    echo "Re-run with ALLOW_NO_XCODE=1 to register anyway." >&2
    exit 1
  fi
fi

if [[ ! -f "$TOKEN_PATH" ]]; then
  echo "Missing runner token file at $TOKEN_PATH" >&2
  exit 1
fi
token="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$TOKEN_PATH")"
rm -f "$TOKEN_PATH"
if [[ -z "$token" ]]; then
  echo "Registration token was empty." >&2
  exit 1
fi

mkdir -p "$RUNNER_DIR"
cd "$RUNNER_DIR"

if [[ ! -x ./config.sh ]]; then
  archive="$TMPDIR/actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
  curl -fsSL --retry 3 \
    -o "$archive" \
    "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-osx-arm64-${RUNNER_VERSION}.tar.gz"
  printf '%s  %s\n' "$RUNNER_SHA256" "$archive" | shasum -a 256 -c -
  tar -xzf "$archive"
  rm -f "$archive"
fi

./config.sh \
  --unattended \
  --replace \
  --url "$REPO_URL" \
  --token "$token" \
  --name "$RUNNER_NAME" \
  --labels "$LABELS" \
  --work _work-t3code-fork

# LaunchAgent so the runner comes back after reboot without a logged-in GUI
# session. Do not expose this runner to pull_request jobs.
plist_dir="$HOME/Library/LaunchAgents"
plist="$plist_dir/actions.runner.t3-pretty.${RUNNER_NAME}.plist"
mkdir -p "$plist_dir"
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>actions.runner.t3-pretty.${RUNNER_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${RUNNER_DIR}/runsvc.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${RUNNER_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>SessionCreate</key>
  <true/>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Registered $RUNNER_NAME at $RUNNER_DIR with labels $LABELS"
