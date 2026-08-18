#!/usr/bin/env bash
# Grok 4.6 Origin PR review on macos-release.
#
# Hosted linux-small cannot load CURSOR_API_KEY. This job is limited to
# same-repo t3code/* branches in pipeline.yml. Prefer file-store secrets
# already used by sync/publish; fall back to secret get.
set -euo pipefail

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
      "/Users/m1-dev/.config/t3-pretty/${name}" \
      "/opt/homebrew/var/buildkite-agent/secrets/${name}"; do
      if [[ -f "$candidate" ]]; then
        value="$(tr -d '\r' < "$candidate")"
        value="${value%$'\n'}"
        break
      fi
    done
  fi
  if [[ -z "$value" && "$name" == "CURSOR_API_KEY" ]]; then
    for candidate in \
      "${HOME}/.config/t3-pretty/cursor-api-key" \
      "/Users/m1-dev/.config/t3-pretty/cursor-api-key"; do
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

echo "host=$(hostname) arch=$(uname -m) node=$(command -v node || echo none)"
echo "Loading cluster secrets"
load_secret CURSOR_API_KEY
load_secret CLI_PROXY_API_KEY

if ! command -v node >/dev/null; then
  echo "node is required on macos-release to review Origin pull requests." >&2
  exit 1
fi

export ORIGIN_REPO="${ORIGIN_REPO:-serbinenko/t3-pretty}"
export CLI_PROXY_REVIEW_MODEL="${CLI_PROXY_REVIEW_MODEL:-grok-4.6}"
# high effort regularly exceeds the request timeout on grok-4.6.
export CLI_PROXY_REVIEW_EFFORT="${CLI_PROXY_REVIEW_EFFORT:-low}"
export CLI_PROXY_API_URL="${CLI_PROXY_API_URL:-https://cli-proxy-api-production-1615.up.railway.app/v1}"

trap report_failure ERR

echo "Authenticating Origin CLI"
node scripts/fork/origin-forge.mjs setup-ci
if [[ "${1:-review}" == "check" ]]; then
  echo "Checking Origin review comments are resolved"
  node scripts/fork/check-origin-pr-comments.mjs
else
  echo "Reviewing Origin pull request"
  node scripts/fork/review-origin-pr.mjs
fi
