#!/bin/bash
# Register a trusted macOS Buildkite agent for T3 Pretty Origin releases.
#
# Queues: macos-release (signed DMG + local iOS). Registers two workers so
# Origin PR review and the DMG can run while a local IPA occupies the first.
# Never add pull-request queues. Requires a cluster agent token from the
# Origin-connected Buildkite org (Agents → Agent tokens).
#
# Usage:
#   printf '%s\n' '{"token":"<agent token>"}' > "$HOME/t3-buildkite-token.json"
#   bash scripts/fork/setup-buildkite-macos-agent.sh
#
# The script deletes the token file after it is read.

set -euo pipefail

TOKEN_PATH="${TOKEN_PATH:-$HOME/t3-buildkite-token.json}"
AGENT_NAME="${AGENT_NAME:-m1-dev-t3code-fork}"
QUEUES="${QUEUES:-macos-release}"
TAGS="${TAGS:-queue=${QUEUES},os=macos,arch=arm64,t3code-fork=true,release-only=true}"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This script is for Apple Silicon macOS only." >&2
  exit 1
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
    <string>$(command -v buildkite-agent)</string>
    <string>start</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$HOME</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>SessionCreate</key>
  <true/>
</dict>
</plist>
PLIST

here="$(cd "$(dirname "$0")" && pwd)"
hooks="$(brew --prefix)/etc/buildkite-agent"
install -m 0755 "$here/macos-origin-git.sh" "$hooks/hooks/pre-checkout"
install -m 0755 "$here/persist-ios-native-submit-hook.sh" "$hooks/hooks/post-checkout"
install -m 0755 "$here/persist-ios-native-submit-hook.sh" "$hooks/hooks/pre-exit"
install -m 0755 "$here/checkout-origin.sh" "$hooks/checkout-origin.sh"
if [[ -f "$HOME/.git-credentials" ]]; then
  bash "$here/macos-origin-git.sh"
else
  echo "Write $HOME/.git-credentials (Origin x-access-token JWT) so Mac jobs can clone."
fi

launchctl bootout "gui/$(id -u)" "$plist" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$plist"
echo "Registered Buildkite agent $AGENT_NAME on queues $QUEUES"

# A second worker on the same queue lets Origin PR review and the signed DMG
# run while a local IPA occupies the first agent. Same token, different name.
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
    <string>$(command -v buildkite-agent)</string>
    <string>start</string>
    <string>--name</string>
    <string>${COMPANION_NAME}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$HOME</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>SessionCreate</key>
  <true/>
</dict>
</plist>
PLIST
  launchctl bootout "gui/$(id -u)" "$companion_plist" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$(id -u)" "$companion_plist"
  echo "Registered companion Buildkite agent $COMPANION_NAME on queues $QUEUES"
fi
