#!/bin/sh
# Install the T3 Pretty headless CLI (not upstream `npx t3`).
# This source is public; publish-cli.sh renders the internal R2/Surge copy.
# Usage: curl -fsSL https://github.com/SergeSerb2/t3-pretty/releases/latest/download/install.sh | sh
set -eu

FEED="${T3_PRETTY_CLI_FEED:-https://github.com/SergeSerb2/t3-pretty/releases/latest/download}"
TARBALL="${T3_PRETTY_CLI_TARBALL:-$FEED/t3.tgz}"

if ! command -v node >/dev/null 2>&1; then
  echo "T3 Pretty needs Node.js 22.16+ or 24.10+. Install Node, then rerun." >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "T3 Pretty needs npm (it ships with Node.js)." >&2
  exit 1
fi

# Fedora/system Node owns /usr/local. Stay in the user prefix so this does not
# need root. Native deps (node-pty) compile here; gcc-c++ and make must exist.
PREFIX="${NPM_CONFIG_PREFIX:-$HOME/.local}"
export NPM_CONFIG_PREFIX="$PREFIX"
mkdir -p "$PREFIX/bin"
echo "Installing T3 Pretty CLI from $TARBALL into $PREFIX"
npm install -g "$TARBALL"

BIN="$PREFIX/bin"
T3_BIN="$BIN/t3"
if [ ! -x "$T3_BIN" ]; then
  echo "npm finished but $T3_BIN is missing. A native dependency (node-pty) usually failed to build. On Fedora/RHEL install gcc-c++ make python3, then rerun." >&2
  exit 1
fi

case ":${PATH}:" in
  *":$BIN:"*) ;;
  *)
    echo "Add $BIN to PATH:"
    echo "  export PATH=\"$BIN:\$PATH\""
    ;;
esac

echo "Installed $T3_BIN ($("$T3_BIN" --version 2>/dev/null || echo ok))."
echo "Next:"
echo "  t3 service install"
echo "  t3 pair"
echo "Then in Settings → Connections, turn on T3 Connect for this environment."
