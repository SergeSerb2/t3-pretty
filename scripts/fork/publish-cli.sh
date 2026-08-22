#!/usr/bin/env bash
# Pack the T3 Pretty headless CLI and upload t3.tgz / t3-<version>.tgz / install.sh
# to the public R2 feed. Native linux-small. Do not git fetch origin: hosted
# linux-small has no Origin HTTPS credentials and git waits forever on the
# username prompt.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

export PATH="${HOME}/.vite-plus/bin:${HOME}/.local/bin:${HOME}/.local/t3-pretty-node24/bin:${PATH}"
export T3CODE_DESKTOP_UPDATE_FEED_URL="${T3CODE_DESKTOP_UPDATE_FEED_URL:-https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/}"
export T3CODE_CLERK_PUBLISHABLE_KEY="${T3CODE_CLERK_PUBLISHABLE_KEY:-pk_live_Y2xlcmsuc2VyZ2VzZXJiaW5lbmtvLmNvbSQ}"
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS="${GIT_ASKPASS:-/bin/true}"

# Hosted linux-small often has no Node. Do not source ensure-linux-node.sh:
# it `exit 0`s when Node is already present and would stop this script.
if ! command -v node >/dev/null; then
  bash scripts/fork/ensure-linux-node.sh
  export PATH="${HOME}/.local/t3-pretty-node24/bin:${PATH}"
fi

# shellcheck source=load-buildkite-secrets.sh
. scripts/fork/load-buildkite-secrets.sh \
  CLOUDFLARE_API_TOKEN \
  T3CODE_RELEASE_S3_ACCESS_KEY_ID \
  T3CODE_RELEASE_S3_SECRET_ACCESS_KEY

if [[ "${T3_PRETTY_CLI_SKIP_UPLOAD:-}" != "1" ]]; then
  if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]] &&
    { [[ -z "${T3CODE_RELEASE_S3_ACCESS_KEY_ID:-}" ]] || [[ -z "${T3CODE_RELEASE_S3_SECRET_ACCESS_KEY:-}" ]]; }; then
    echo "Need CLOUDFLARE_API_TOKEN or T3CODE_RELEASE_S3_ACCESS_KEY_ID+SECRET from cluster secrets." >&2
    exit 1
  fi
  if [[ -z "${T3CODE_RELEASE_S3_BUCKET:-}" || -z "${T3CODE_RELEASE_S3_ENDPOINT:-}" ]]; then
    echo "T3CODE_RELEASE_S3_BUCKET and T3CODE_RELEASE_S3_ENDPOINT must come from pipeline env." >&2
    exit 1
  fi
fi

# Remotes install t3-<desktopVersion>.tgz. Pack the version macos-dmg just
# published. Do not remint: flooring against that live slot yields highest+1
# and SSH/pinned-runtime 404.
version=""
for manifest in latest-mac.yml latest-linux.yml latest.yml; do
  feed_file="$(mktemp)"
  feed_code="$(curl -sSL --max-time 30 -o "$feed_file" -w '%{http_code}' "${T3CODE_DESKTOP_UPDATE_FEED_URL%/}/${manifest}" || true)"
  if [[ "$feed_code" == "404" ]]; then
    rm -f "$feed_file"
    continue
  fi
  if [[ ! "$feed_code" =~ ^2 ]]; then
    rm -f "$feed_file"
    echo "Cannot read live update manifest ${manifest} (HTTP $feed_code)." >&2
    exit 1
  fi
  feed_version="$(sed -n 's/^version: *//p' "$feed_file" | head -n 1)"
  rm -f "$feed_file"
  feed_version="${feed_version%$'\r'}"
  feed_version="${feed_version#\"}"
  feed_version="${feed_version%\"}"
  if [[ -n "$feed_version" ]]; then
    version="$feed_version"
    break
  fi
done
if [[ -z "$version" ]]; then
  echo "Desktop feed has no version; refusing to publish a CLI tarball remotes will not find." >&2
  exit 1
fi

vp_is_official() {
  command -v vp >/dev/null || return 1
  local out
  out="$(vp --version 2>&1 || true)"
  [[ "$out" != *"npx vp"* ]]
}

if ! vp_is_official; then
  export CI=true
  curl -fsSL https://vite.plus | bash
  export PATH="${HOME}/.vite-plus/bin:${HOME}/.local/bin:${PATH}"
fi
if ! vp_is_official; then
  echo "vp is required to pack the CLI." >&2
  exit 1
fi

echo "Packing T3 Pretty CLI $version"

vp i --filter=t3... --filter=@t3tools/web... --filter=@t3tools/scripts...
node scripts/update-release-package-versions.ts "$version"
vp run --filter t3 build

tmp="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT

node apps/server/scripts/cli.ts pack --app-version "$version" --out-dir "$tmp" --verbose
tarball="$tmp/t3-${version}.tgz"
test -f "$tarball"
cp "$tarball" "$tmp/t3.tgz"
cp scripts/fork/install-cli.sh "$tmp/install.sh"
chmod 755 "$tmp/install.sh"

if [[ "${T3_PRETTY_CLI_SKIP_UPLOAD:-}" == "1" ]]; then
  echo "Skipping upload (T3_PRETTY_CLI_SKIP_UPLOAD=1). Tarball: $tarball"
  exit 0
fi

node scripts/fork/origin-forge.mjs upload-assets \
  --asset "$tmp/t3-${version}.tgz" \
  --asset "$tmp/t3.tgz" \
  --asset "$tmp/install.sh"
echo "Published CLI $version to ${T3CODE_DESKTOP_UPDATE_FEED_URL}"
