#!/usr/bin/env bash
# Pack the T3 Pretty headless CLI and upload t3.tgz / t3-<version>.tgz / install.sh
# to the public R2 feed. Native linux-small (and a packaging Mac) can run this.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

export PATH="${HOME}/.vite-plus/bin:${HOME}/.local/bin:${HOME}/.local/t3-pretty-node24/bin:${PATH}"

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

export T3CODE_DESKTOP_UPDATE_FEED_URL="${T3CODE_DESKTOP_UPDATE_FEED_URL:-https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/}"
export T3CODE_RELEASE_S3_BUCKET="${T3CODE_RELEASE_S3_BUCKET:-t3-pretty-releases}"
export T3CODE_RELEASE_S3_ENDPOINT="${T3CODE_RELEASE_S3_ENDPOINT:-https://a6f705b8c6459d937d32d31555f9fbf6.r2.cloudflarestorage.com}"
export T3CODE_RELEASE_S3_REGION="${T3CODE_RELEASE_S3_REGION:-auto}"
export T3CODE_CLERK_PUBLISHABLE_KEY="${T3CODE_CLERK_PUBLISHABLE_KEY:-pk_live_Y2xlcmsuc2VyZ2VzZXJiaW5lbmtvLmNvbSQ}"

if ! command -v vp >/dev/null; then
  echo "vp is required to pack the CLI." >&2
  exit 1
fi

if [[ -z "${GITHUB_RUN_NUMBER:-}" && -n "${BUILDKITE_BUILD_NUMBER:-}" ]]; then
  export GITHUB_RUN_NUMBER="$BUILDKITE_BUILD_NUMBER"
fi

git fetch --force --tags origin || echo "warning: could not fetch Origin tags"
git fetch --force --tags upstream || echo "warning: could not fetch upstream tags"

version="$(node scripts/fork/resolve-fork-release.mjs --print version)"
test -n "$version"
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
