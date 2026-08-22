#!/bin/bash
# Register a trusted macOS Buildkite agent for T3 Pretty Origin CI.
#
# Default queue is macos-release (Origin PR Review). Packaging (DMG, iOS,
# relay, upstream sync) is macos-package — pass QUEUES=macos-package on a
# Mac that should take those jobs. Registers two workers unless REVIEW_ONLY=1
# so review and a DMG can run while a local IPA occupies the first.
# Never add pull-request queues. Requires a cluster agent token from the
# Origin-connected Buildkite org (Agents → Agent tokens).
#
# Machines without a full Xcode.app default to REVIEW_ONLY=1 so they refuse
# packaging jobs that still match macos-release on older pipeline.yml files.
#
# Usage:
#   printf '%s\n' '{"token":"<agent token>"}' > "$HOME/t3-buildkite-token.json"
#   bash scripts/fork/setup-buildkite-macos-agent.sh
#
# The script deletes the token file after it is read.

set -euo pipefail

TOKEN_PATH="${TOKEN_PATH:-$HOME/t3-buildkite-token.json}"
short="$(hostname -s 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9-' )"
AGENT_NAME="${AGENT_NAME:-${short:-macos}-t3code-fork}"
QUEUES="${QUEUES:-macos-release}"
TAGS="${TAGS:-queue=${QUEUES},os=macos,arch=arm64,t3code-fork=true,release-only=true}"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This script is for Apple Silicon macOS only." >&2
  exit 1
fi

has_full_xcode=0
for app in /Applications/Xcode.app /Applications/Xcode-beta.app /Applications/Xcode*.app; do
  if [[ -x "$app/Contents/Developer/usr/bin/xcodebuild" ]]; then
    has_full_xcode=1
    break
  fi
done
if [[ -z "${REVIEW_ONLY:-}" ]]; then
  if (( has_full_xcode == 0 )); then
    REVIEW_ONLY=1
  else
    REVIEW_ONLY=0
  fi
fi

if [[ ! -f "$TOKEN_PATH" ]]; then
  echo "Missing Buildkite token file at $TOKEN_PATH" >&2
  exit 1
fi

if ! command -v brew >/dev/null; then
  echo "Homebrew is required to install buildkite-agent." >&2
  exit 1
fi

if ! command -v buildkite-agent >/dev/null; then
  export HOMEBREW_NO_AUTO_UPDATE=1
  brew tap buildkite/buildkite >/dev/null
  brew trust buildkite/buildkite >/dev/null || true
  brew install buildkite/buildkite/buildkite-agent
fi

token="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["token"])' "$TOKEN_PATH")"
rm -f "$TOKEN_PATH"
if [[ -z "$token" ]]; then
  echo "Agent token was empty." >&2
  exit 1
fi

cfg="$(brew --prefix)/etc/buildkite-agent/buildkite-agent.cfg"
if [[ ! -f "$cfg" ]]; then
  echo "Missing $cfg after install." >&2
  exit 1
fi

python3 - "$cfg" "$token" "$AGENT_NAME" "$TAGS" <<'PY'
import pathlib, sys
path, token, name, tags = sys.argv[1:]
text = pathlib.Path(path).read_text()
replacements = {
    "token=": f"token=\"{token}\"",
    "name=": f"name=\"{name}\"",
    "tags=": f"tags=\"{tags}\"",
}
lines = []
seen = set()
for line in text.splitlines():
    stripped = line.lstrip("# ").strip()
    key = next((prefix for prefix in replacements if stripped.startswith(prefix)), None)
    if key and key not in seen:
        lines.append(replacements[key])
        seen.add(key)
    else:
        lines.append(line)
for key, value in replacements.items():
    if key not in seen:
        lines.append(value)
pathlib.Path(path).write_text("\n".join(lines) + "\n")
PY

agent_bin="$(command -v buildkite-agent)"
agent_path="/opt/homebrew/bin:/opt/homebrew/sbin:${HOME}/.local/bin:${HOME}/.vite-plus/bin:/usr/bin:/bin:/usr/sbin:/sbin"
mkdir -p "$HOME/.config/t3-pretty" "$HOME/Library/Logs"
: >> "$HOME/.config/t3-pretty/gitconfig"
chmod 600 "$HOME/.config/t3-pretty/gitconfig" 2>/dev/null || true
plist_dir="$HOME/Library/LaunchAgents"
plist="$plist_dir/com.buildkite.t3-pretty.${AGENT_NAME}.plist"
mkdir -p "$plist_dir"
cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.buildkite.t3-pretty.${AGENT_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${agent_bin}</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$HOME</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>${agent_path}</string>
    <key>GIT_CONFIG_GLOBAL</key>
    <string>$HOME/.config/t3-pretty/gitconfig</string>
    <key>FORCE_COLOR</key>
    <string>0</string>
    <key>T3_PRETTY_REVIEW_ONLY</key>
    <string>${REVIEW_ONLY}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>SessionCreate</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/t3-pretty-buildkite-agent.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/t3-pretty-buildkite-agent.err.log</string>
</dict>
</plist>
PLIST

here="$(cd "$(dirname "$0")" && pwd)"
hooks="$(brew --prefix)/etc/buildkite-agent"
mkdir -p "$hooks/hooks"
install -m 0755 "$here/macos-origin-git.sh" "$hooks/hooks/pre-checkout"
install -m 0755 "$here/macos-review-only-hook.sh" "$hooks/hooks/pre-command"
install -m 0755 "$here/persist-ios-native-submit-hook.sh" "$hooks/hooks/post-checkout"
install -m 0755 "$here/persist-ios-native-submit-hook.sh" "$hooks/hooks/pre-exit"
install -m 0755 "$here/checkout-origin.sh" "$hooks/checkout-origin.sh"
if GIT_CONFIG_GLOBAL="$HOME/.config/t3-pretty/gitconfig" bash "$here/macos-origin-git.sh"; then
  :
else
  echo "Write $HOME/.git-credentials (Origin x-access-token JWT) or run origin auth setup-git so Mac jobs can clone."
fi

launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Registered Buildkite agent $AGENT_NAME on queues $QUEUES (REVIEW_ONLY=${REVIEW_ONLY})"

# A second worker on the same queue lets Origin PR review and the signed DMG
# run while a local IPA occupies the first agent. Same token, different name.
# Review-only daily drivers skip it: one worker is enough for Grok reviews.
if [[ "$REVIEW_ONLY" == "1" ]]; then
  COMPANION_NAME="${COMPANION_NAME:-$AGENT_NAME}"
fi
COMPANION_NAME="${COMPANION_NAME:-${AGENT_NAME}-2}"
if [[ "$COMPANION_NAME" != "$AGENT_NAME" ]]; then
  companion_plist="$plist_dir/com.buildkite.t3-pretty.${COMPANION_NAME}.plist"
  cat > "$companion_plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.buildkite.t3-pretty.${COMPANION_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${agent_bin}</string>
    <string>start</string>
    <string>--name</string>
    <string>${COMPANION_NAME}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$HOME</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME</string>
    <key>PATH</key>
    <string>${agent_path}</string>
    <key>GIT_CONFIG_GLOBAL</key>
    <string>$HOME/.config/t3-pretty/gitconfig</string>
    <key>FORCE_COLOR</key>
    <string>0</string>
    <key>T3_PRETTY_REVIEW_ONLY</key>
    <string>${REVIEW_ONLY}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>SessionCreate</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/Library/Logs/t3-pretty-buildkite-agent-2.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/Library/Logs/t3-pretty-buildkite-agent-2.err.log</string>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)" "$companion_plist" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$companion_plist"
  echo "Registered companion Buildkite agent $COMPANION_NAME on queues $QUEUES"
fi
