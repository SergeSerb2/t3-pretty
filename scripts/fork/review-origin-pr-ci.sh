#!/usr/bin/env bash
# Grok 4.6 Origin PR review on macos-release.
#
# Hosted linux-small cannot load CURSOR_API_KEY. Load secrets from
# buildkite-agent or $HOME only — never a hardcoded machine path.
# Prefer scripts copied from origin/main (see run-trusted-origin-pr-ci.sh).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:${HOME}/.vite-plus/bin:${HOME}/.local/bin:${PATH}"

load_secret() {
  local name="$1"
  local value="${!name:-}"
  local candidate
  if [[ -z "$value" ]] && command -v buildkite-agent >/dev/null; then
    value="$(buildkite-agent secret get "$name" 2>/dev/null || true)"
  fi
  if [[ -z "$value" ]]; then
    for candidate in \
      "${HOME}/.config/t3-pretty/${name}" \
      "${HOME}/.config/t3-pretty/cursor-api-key"; do
      if [[ "$name" != "CURSOR_API_KEY" && "$candidate" == *cursor-api-key ]]; then
        continue
      fi
      if [[ -f "$candidate" ]]; then
        value="$(tr -d '\r' < "$candidate")"
        value="${value%$'\n'}"
        break
      fi
    done
  fi
  if [[ -z "$value" ]]; then
    echo "cluster secret $name is not available on this agent" >&2
    return 1
  fi
  printf -v "$name" '%s' "$value"
  export "$name"
}

ensure_node() {
  if command -v node >/dev/null; then
    echo "Using $(command -v node) ($(node --version))"
    return 0
  fi
  if command -v brew >/dev/null; then
    echo "Installing node with Homebrew"
    HOMEBREW_NO_ASK=1 HOMEBREW_NO_AUTO_UPDATE=1 brew install node
    return 0
  fi
  local ver="v24.13.1"
  local arch
  case "$(uname -m)" in
    arm64) arch="darwin-arm64" ;;
    *) arch="darwin-x64" ;;
  esac
  local dir
  dir="$(mktemp -d)"
  echo "Installing node ${ver} ${arch}"
  curl -fsSL "https://nodejs.org/dist/${ver}/node-${ver}-${arch}.tar.gz" | tar -xz -C "$dir" --strip-components=1
  export PATH="${dir}/bin:${PATH}"
  command -v node >/dev/null
}

report_failure() {
  local target="${BUILDKITE_PULL_REQUEST:-}"
  if [[ -z "$target" || "$target" == "false" ]]; then
    target="${BUILDKITE_BRANCH:-}"
  fi
  if command -v origin >/dev/null && [[ -n "${CURSOR_API_KEY:-}" && -n "$target" ]]; then
    origin pr comment "$target" -R "${ORIGIN_REPO:-serbinenko/t3-pretty}" \
      -b "Origin PR review job failed on this build. Check the Buildkite \`Origin PR Review\` step log." || true
  fi
}

mode="${1:-review}"
if [[ "$mode" != "check" ]]; then
  trap report_failure ERR
fi

echo "host=$(hostname) arch=$(uname -m) node=$(command -v node || echo none)"
echo "Loading cluster secrets"
load_secret CURSOR_API_KEY
load_secret CLI_PROXY_API_KEY
ensure_node

export ORIGIN_REPO="${ORIGIN_REPO:-serbinenko/t3-pretty}"
export CLI_PROXY_REVIEW_MODEL="${CLI_PROXY_REVIEW_MODEL:-grok-4.6}"
# high effort regularly exceeds the request timeout on grok-4.6.
export CLI_PROXY_REVIEW_EFFORT="${CLI_PROXY_REVIEW_EFFORT:-low}"
export CLI_PROXY_API_URL="${CLI_PROXY_API_URL:-https://cli-proxy-api-production-1615.up.railway.app/v1}"

echo "Authenticating Origin CLI"
node "${HERE}/origin-forge.mjs" setup-ci
if [[ "$mode" == "check" ]]; then
  echo "Checking Origin review comments are resolved"
  node "${HERE}/check-origin-pr-comments.mjs"
else
  echo "Reviewing Origin pull request"
  node "${HERE}/review-origin-pr.mjs"
fi
