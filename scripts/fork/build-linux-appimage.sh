#!/usr/bin/env bash
# Native linux-small x64 AppImage. Parallel to build-macos-dmg.sh /
# build-windows-nsis.ps1. Do not git fetch origin: hosted linux-small has no
# Origin HTTPS credentials and git waits forever on the username prompt.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

export PATH="${HOME}/.vite-plus/bin:${HOME}/.local/t3-pretty-node24/bin:${HOME}/.local/bin:${HOME}/.cargo/bin:${PATH}"
export T3CODE_DESKTOP_UPDATE_FEED_URL="${T3CODE_DESKTOP_UPDATE_FEED_URL:-https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/}"
export T3CODE_CLERK_PUBLISHABLE_KEY="${T3CODE_CLERK_PUBLISHABLE_KEY:-pk_live_Y2xlcmsuc2VyZ2VzZXJiaW5lbmtvLmNvbSQ}"
# Public feed location — same literals as .buildkite/pipeline.yml env. Not cluster
# secrets. Native linux-small inherits pipeline env; keep defaults if a job
# starts without it so origin-forge upload-assets still has a bucket.
export T3CODE_RELEASE_S3_BUCKET="${T3CODE_RELEASE_S3_BUCKET:-t3-pretty-releases}"
export T3CODE_RELEASE_S3_ENDPOINT="${T3CODE_RELEASE_S3_ENDPOINT:-https://a6f705b8c6459d937d32d31555f9fbf6.r2.cloudflarestorage.com}"
export T3CODE_RELEASE_S3_REGION="${T3CODE_RELEASE_S3_REGION:-auto}"
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS="${GIT_ASKPASS:-/bin/true}"
export APPIMAGE_EXTRACT_AND_RUN=1
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=3072}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "build-linux-appimage.sh must run on Linux." >&2
  exit 1
fi
host_arch="$(uname -m)"
if [[ "$host_arch" != "x86_64" && "$host_arch" != "amd64" ]]; then
  echo "Linux AppImage CI builds x64 on linux-small; this host is ${host_arch}." >&2
  exit 1
fi

if [[ -z "${GITHUB_RUN_NUMBER:-}" ]]; then
  test -n "${BUILDKITE_BUILD_NUMBER:-}"
  export GITHUB_RUN_NUMBER="$BUILDKITE_BUILD_NUMBER"
fi

# Cluster secrets after checkout: hosted YAML `secrets:` 500s. The helper
# calls `buildkite-agent secret get` (works on hosted linux-small) then
# file-store fallbacks that only exist on self-hosted Macs/Windows.
# shellcheck source=load-buildkite-secrets.sh
. "${root}/scripts/fork/load-buildkite-secrets.sh" \
  CLOUDFLARE_API_TOKEN \
  T3CODE_RELEASE_S3_ACCESS_KEY_ID \
  T3CODE_RELEASE_S3_SECRET_ACCESS_KEY \
  VITE_SCENERY_UNSPLASH_KEY

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]] &&
  { [[ -z "${T3CODE_RELEASE_S3_ACCESS_KEY_ID:-}" ]] || [[ -z "${T3CODE_RELEASE_S3_SECRET_ACCESS_KEY:-}" ]]; }; then
  echo "Need CLOUDFLARE_API_TOKEN or T3CODE_RELEASE_S3_ACCESS_KEY_ID+SECRET from cluster secrets (buildkite-agent secret get). Hosted linux-small has no file-store fallback." >&2
  exit 1
fi
test -n "${T3CODE_RELEASE_S3_BUCKET:-}"

if git remote get-url upstream >/dev/null 2>&1; then
  git remote set-url upstream https://github.com/pingdotgg/t3code.git
else
  git remote add upstream https://github.com/pingdotgg/t3code.git
fi
git fetch --force --tags upstream

# No Origin fork tags are reachable here (see header), so the monotonic floor
# comes from the versions already live on the public desktop update feeds.
# Floor against the whole feed family (Linux + macOS + Windows) so a first
# Linux publish cannot mint below the Mac/Windows slot from the same main
# build. 404 means that feed has never published (no floor from it); any
# other fetch/parse failure must fail the job or resolve-fork-release can
# mint below an already-shipped slot.
build_floor=""
for manifest in latest-linux.yml latest-mac.yml latest.yml; do
  feed_file="$(mktemp)"
  feed_code="$(curl -sSL --max-time 30 -o "$feed_file" -w '%{http_code}' "${T3CODE_DESKTOP_UPDATE_FEED_URL%/}/${manifest}" || true)"
  if [[ "$feed_code" == "404" ]]; then
    rm -f "$feed_file"
    continue # never published, nothing live to floor against
  fi
  if [[ ! "$feed_code" =~ ^2 ]]; then
    rm -f "$feed_file"
    echo "Cannot read live update manifest ${manifest} (HTTP $feed_code); refusing to mint a version below the shipped slot." >&2
    exit 1
  fi
  feed_version="$(sed -n 's/^version: *//p' "$feed_file" | head -n 1)"
  rm -f "$feed_file"
  feed_version="${feed_version%$'\r'}"
  feed_version="${feed_version#\"}"
  feed_version="${feed_version%\"}"
  if [[ -z "$feed_version" ]]; then
    echo "Live update manifest ${manifest} has no version field; refusing to mint a version below the shipped slot." >&2
    exit 1
  fi
  if [[ ! "$feed_version" =~ -nightly\.[0-9]{8}\.([0-9]+)$ ]]; then
    echo "Live update manifest ${manifest} version '$feed_version' is not a nightly build id; refusing to mint a version below the shipped slot." >&2
    exit 1
  fi
  if [[ -z "$build_floor" ]] || (( 10#${BASH_REMATCH[1]} > 10#${build_floor} )); then
    build_floor="${BASH_REMATCH[1]}"
  fi
done
if [[ -n "$build_floor" ]]; then
  export T3_FORK_BUILD_FLOOR="$build_floor"
fi

bash scripts/fork/ensure-linux-node.sh
if [[ -d "${HOME}/.local/t3-pretty-node24/bin" ]]; then
  export PATH="${HOME}/.local/t3-pretty-node24/bin:${PATH}"
fi
command -v node >/dev/null

version="$(node scripts/fork/resolve-fork-release.mjs --print version)"
test -n "$version"
echo "Building Linux x64 AppImage $version"

export DEBIAN_FRONTEND=noninteractive
if command -v sudo >/dev/null && command -v apt-get >/dev/null; then
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends \
    python3 make g++ gcc file imagemagick xz-utils ca-certificates
  sudo apt-get install -y --no-install-recommends libfuse2 ||
    sudo apt-get install -y --no-install-recommends libfuse2t64 ||
    true
fi
if ! command -v magick >/dev/null && ! command -v convert >/dev/null; then
  echo "ImageMagick (magick or convert) is required to stage Linux icons." >&2
  exit 1
fi

if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
fi
# shellcheck disable=SC1091
if [[ -f "${HOME}/.cargo/env" ]]; then
  . "${HOME}/.cargo/env"
fi
export PATH="${HOME}/.cargo/bin:${PATH}"
rustup toolchain install stable --profile minimal --no-self-update
rustup target add x86_64-unknown-linux-gnu
rustup default stable

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
  echo "vp is required on linux-small." >&2
  exit 1
fi

vp i --filter=@t3tools/desktop... --filter=t3... --filter=@t3tools/scripts...
node scripts/update-release-package-versions.ts "$version"

mkdir -p "$HOME/.cache/t3-pretty-release/target-linux-x64"
# CARGO_HOME stays at rustup's default ~/.cargo; overriding it here would hide
# the toolchain installed above. Only the target dir moves to the cache.
export CARGO_TARGET_DIR="$HOME/.cache/t3-pretty-release/target-linux-x64"

node scripts/build-desktop-artifact.ts \
  --platform linux --target AppImage --arch x64 \
  --build-version "$version" --verbose

publish="$root/release-publish"
rm -rf "$publish"
mkdir -p "$publish"
# Linux objects only. A generic nightly.yml/latest.yml here would land on the
# shared R2 prefix and overwrite the Windows NSIS manifest.
find release -maxdepth 1 -type f \( \
  -name '*.AppImage' -o -name '*.AppImage.blockmap' -o -name '*-linux.yml' \
\) -exec cp {} "$publish"/ \;
if [[ -f "$publish/nightly-linux.yml" ]]; then
  cp "$publish/nightly-linux.yml" "$publish/latest-linux.yml"
fi

appimage="$(find "$publish" -maxdepth 1 -type f -name '*.AppImage' -print -quit)"
test -n "$appimage"
file "$appimage" | tee /dev/stderr | grep -Eq 'x86[-_]64'
test -f "$publish/nightly-linux.yml" || test -f "$publish/latest-linux.yml"
# Unversioned name for the README download link; the versioned file stays
# canonical for electron-updater via latest-linux.yml.
cp "$appimage" "$publish/T3-Code-x64.AppImage"

if command -v buildkite-agent >/dev/null; then
  (cd "$publish" && buildkite-agent artifact upload '*')
fi

assets=()
for file in "$publish"/*.{AppImage,blockmap,yml}; do
  [[ -f "$file" ]] || continue
  assets+=(--asset "$file")
done
(( ${#assets[@]} > 0 ))
node scripts/fork/origin-forge.mjs upload-assets "${assets[@]}"
echo "Published Linux x64 $version to $T3CODE_DESKTOP_UPDATE_FEED_URL"
echo "appimage=$appimage"
