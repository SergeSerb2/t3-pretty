#!/usr/bin/env bash
# Grok 4.6 Origin PR review on hosted linux-small.
#
# Do not run this on macos-release. That agent holds cluster secrets
# and must not execute feature-branch scripts. Load secrets only from
# `buildkite-agent secret get`, then install node and the Origin CLI
# on the ephemeral hosted VM.
set -euo pipefail

export PATH="${HOME}/.local/bin:${PATH}"

load_secret() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]] && command -v buildkite-agent >/dev/null; then
    value="$(buildkite-agent secret get "$name" 2>/dev/null || true)"
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
  local ver="v24.13.1"
  local dir
  dir="$(mktemp -d)"
  echo "Installing node ${ver}"
  curl -fsSL "https://nodejs.org/dist/${ver}/node-${ver}-linux-x64.tar.xz" | tar -xJ -C "$dir" --strip-components=1
  export PATH="${dir}/bin:${PATH}"
  command -v node >/dev/null
}

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
node scripts/fork/origin-forge.mjs setup-ci
echo "Reviewing Origin pull request"
node scripts/fork/review-origin-pr.mjs
