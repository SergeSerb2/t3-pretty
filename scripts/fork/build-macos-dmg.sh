#!/usr/bin/env bash
# Native macos-release arm64 DMG. Imported GHA macos-latest jobs now land on
# hosted Macs that cannot sign or see the Origin git store.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

export PATH="/opt/homebrew/bin:${HOME}/.vite-plus/bin:${HOME}/.cargo/bin:${HOME}/.local/bin:${PATH}"
export T3CODE_DESKTOP_UPDATE_FEED_URL="${T3CODE_DESKTOP_UPDATE_FEED_URL:-https://pub-8033bcab5baf492b81c605581ff028e0.r2.dev/t3-pretty/latest/}"
export T3CODE_CLERK_PUBLISHABLE_KEY="${T3CODE_CLERK_PUBLISHABLE_KEY:-pk_live_Y2xlcmsuc2VyZ2VzZXJiaW5lbmtvLmNvbSQ}"
export APPLE_TEAM_ID="${APPLE_TEAM_ID:-78A5P57U23}"
export T3CODE_APPLE_TEAM_ID="${T3CODE_APPLE_TEAM_ID:-$APPLE_TEAM_ID}"

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
    echo "Missing $name" >&2
    return 1
  fi
  printf -v "$name" '%s' "$value"
  export "$name"
}

load_secret CSC_LINK
load_secret CSC_KEY_PASSWORD
load_secret APPLE_API_KEY
load_secret APPLE_API_KEY_ID
load_secret APPLE_API_ISSUER
load_secret CLOUDFLARE_API_TOKEN
if [[ -z "${VITE_SCENERY_UNSPLASH_KEY:-}" ]]; then
  load_secret VITE_SCENERY_UNSPLASH_KEY || true
fi

if [[ -z "${GITHUB_RUN_NUMBER:-}" ]]; then
  test -n "${BUILDKITE_BUILD_NUMBER:-}"
  export GITHUB_RUN_NUMBER="$BUILDKITE_BUILD_NUMBER"
fi

if git remote get-url upstream >/dev/null 2>&1; then
  git remote set-url upstream https://github.com/pingdotgg/t3code.git
else
  git remote add upstream https://github.com/pingdotgg/t3code.git
fi
git fetch --force --tags upstream

version="$(node scripts/fork/resolve-fork-release.mjs | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')"
echo "Building macOS arm64 $version"

if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal
fi
rustup toolchain install stable --profile minimal --no-self-update
rustup target add aarch64-apple-darwin
rustup default stable

if ! command -v vp >/dev/null; then
  echo "vp is required on macos-release." >&2
  exit 1
fi
vp i --filter=@t3tools/desktop... --filter=t3... --filter=@t3tools/scripts...
node scripts/update-release-package-versions.ts "$version"

tmp="${TMPDIR:-/tmp}/t3-macos-release-$$"
mkdir -p "$tmp"
cleanup() {
  security list-keychains -d user -s "$HOME/Library/Keychains/login.keychain-db" >/dev/null 2>&1 || true
  security delete-keychain "$tmp/fork-release.keychain-db" >/dev/null 2>&1 || true
  rm -rf "$tmp"
}
trap cleanup EXIT

key_path="$tmp/AuthKey_${APPLE_API_KEY_ID}.p8"
printf '%s' "$APPLE_API_KEY" > "$key_path"
export APPLE_API_KEY="$key_path"
export T3CODE_MACOS_SKIP_PASSKEY_PROFILE=1

signing_keychain="$tmp/fork-release.keychain-db"
keychain_password="$(openssl rand -hex 32)"
certificate_path="$tmp/DeveloperIDApplication.p12"
developer_id_g2_path="$tmp/DeveloperIDG2CA.cer"
printf '%s' "$CSC_LINK" | tr -d ' \n' | base64 -D > "$certificate_path"
curl --fail --location --silent --show-error \
  -o "$developer_id_g2_path" \
  "https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer"
printf '%s  %s\n' \
  "f16cd3c54c7f83cea4bf1a3e6a0819c8aaa8e4a1528fd144715f350643d2df3a" \
  "$developer_id_g2_path" | shasum -a 256 -c -
security delete-keychain "$signing_keychain" >/dev/null 2>&1 || true
security create-keychain -p "$keychain_password" "$signing_keychain"
security set-keychain-settings -lut 21600 "$signing_keychain"
security unlock-keychain -p "$keychain_password" "$signing_keychain"
security import "$developer_id_g2_path" -k "$signing_keychain"
security import "$certificate_path" -k "$signing_keychain" -P "$CSC_KEY_PASSWORD" -T /usr/bin/codesign
security set-key-partition-list -S 'apple-tool:,apple:,codesign:' -s -k "$keychain_password" "$signing_keychain" >/dev/null
security list-keychains -d user -s "$signing_keychain" "$HOME/Library/Keychains/login.keychain-db"
identity_name="$(security find-identity -v -p codesigning "$signing_keychain" |
  sed -n 's/.*"Developer ID Application: \([^"]*\)".*/\1/p' | head -n 1)"
test -n "$identity_name"
rm -f "$certificate_path"
export CSC_KEYCHAIN="$signing_keychain"
export CSC_NAME="$identity_name"
unset CSC_LINK CSC_KEY_PASSWORD

mkdir -p "$HOME/.cache/t3-pretty-release/cargo" "$HOME/.cache/t3-pretty-release/target-macos-arm64"
export CARGO_HOME="$HOME/.cache/t3-pretty-release/cargo"
export CARGO_TARGET_DIR="$HOME/.cache/t3-pretty-release/target-macos-arm64"

node scripts/build-desktop-artifact.ts \
  --platform mac --target dmg --arch arm64 \
  --build-version "$version" --verbose --signed

zip_path="$(find release -maxdepth 1 -type f -name '*-arm64.zip' -print -quit)"
test -n "$zip_path"
verify_dir="$tmp/verify"
mkdir -p "$verify_dir"
ditto -x -k "$zip_path" "$verify_dir"
app_path="$(find "$verify_dir" -maxdepth 2 -type d -name '*.app' -print -quit)"
test -n "$app_path"
codesign --verify --deep --strict --verbose=2 "$app_path"
team_identifier="$(codesign -d --verbose=4 "$app_path" 2>&1 | sed -n 's/^TeamIdentifier=//p')"
[[ "$team_identifier" == "$APPLE_TEAM_ID" ]]
unzip -p "$zip_path" '*/Contents/Resources/app-update.yml' > "$tmp/app-update.yml"
grep -F 'provider: generic' "$tmp/app-update.yml"
grep -F "${T3CODE_DESKTOP_UPDATE_FEED_URL%/}/" "$tmp/app-update.yml"

publish="$root/release-publish"
rm -rf "$publish"
mkdir -p "$publish"
find release -maxdepth 1 -type f \( \
  -name '*.dmg' -o -name '*.zip' -o -name '*.blockmap' -o -name '*.yml' \
\) -exec cp {} "$publish"/ \;
for nightly in "$publish"/nightly*.yml; do
  [[ -f "$nightly" ]] || continue
  cp "$nightly" "${nightly/nightly/latest}"
done

if command -v buildkite-agent >/dev/null; then
  (cd "$publish" && buildkite-agent artifact upload '*')
fi

assets=()
for file in "$publish"/*.{dmg,zip,blockmap,yml}; do
  [[ -f "$file" ]] || continue
  assets+=(--asset "$file")
done
(( ${#assets[@]} > 0 ))
node scripts/fork/origin-forge.mjs upload-assets "${assets[@]}"
echo "Published macOS arm64 $version to $T3CODE_DESKTOP_UPDATE_FEED_URL"
echo "dmg=$(find "$publish" -name '*.dmg' -print -quit)"
