#!/usr/bin/env bash
# Production relay deploy on macos-release. Imported GHA macos-latest jobs
# can land on hosted Macs that do not have the Origin git store or the
# m1-dev file-store secrets.
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
  if [[ -z "$value" ]]; then
    echo "Missing relay secret: $name" >&2
    return 1
  fi
  printf -v "$name" '%s' "$value"
  export "$name"
}

load_secret CLOUDFLARE_API_TOKEN
load_secret PLANETSCALE_API_TOKEN_ID
load_secret PLANETSCALE_API_TOKEN
load_secret CLERK_SECRET_KEY
load_secret APNS_PRIVATE_KEY
load_secret AXIOM_TOKEN

if ! command -v vp >/dev/null; then
  echo "vp is required on macos-release to deploy the relay." >&2
  exit 1
fi

vp i --filter t3code-relay...
vp run --filter t3code-relay configure-clerk
vp run --filter t3code-relay deploy --stage prod --yes
