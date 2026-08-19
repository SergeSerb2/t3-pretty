#!/usr/bin/env bash
# Native macos-release iOS OTA + TestFlight. Same machine as the signed DMG
# (m1-dev). The GitHub Actions importer cannot load cluster secrets or keep
# PATH across steps, so imported Expo/EAS jobs die in seconds and TestFlight
# never sees the update.
#
# Installed TestFlight binaries already poll the fork Expo Updates URL baked
# into the IPA. This script publishes that JS channel with eas-cli on this Mac
# and, when the native fingerprint changes, compiles a local IPA and submits
# it to TestFlight. It does not use Expo cloud iOS builds.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:${HOME}/.vite-plus/bin:${HOME}/.local/bin:${PATH}"
export APP_VARIANT="${APP_VARIANT:-production}"
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"
export T3CODE_MOBILE_UPDATE_URL="${T3CODE_MOBILE_UPDATE_URL:-https://u.expo.dev/1eb51d67-48c5-4100-8aa8-f5ac9e1ada65}"
export T3CODE_MOBILE_EAS_PROJECT_ID="${T3CODE_MOBILE_EAS_PROJECT_ID:-1eb51d67-48c5-4100-8aa8-f5ac9e1ada65}"
export T3CODE_MOBILE_EXPO_OWNER="${T3CODE_MOBILE_EXPO_OWNER:-sergeserbinenkoteam}"
export T3CODE_MOBILE_EXPO_SLUG="${T3CODE_MOBILE_EXPO_SLUG:-t3-pretty}"
export T3CODE_IOS_SHARE_EXTENSION="${T3CODE_IOS_SHARE_EXTENSION:-0}"
export ORIGIN_REPO="${ORIGIN_REPO:-serbinenko/t3-pretty}"

MODE="${T3CODE_MOBILE_MODE:-release}"
PLATFORM="${T3CODE_MOBILE_PLATFORM:-all}"
FORCE_IOS=false
case "${T3CODE_FORCE_IOS:-}" in
  true | TRUE | 1 | yes | YES) FORCE_IOS=true ;;
esac

commit="${BUILDKITE_COMMIT:-${GITHUB_SHA:-$(git rev-parse HEAD)}}"
update_message="${T3CODE_MOBILE_UPDATE_MESSAGE:-Production OTA (${commit})}"

echo "T3 Pretty mobile release on macos-release (m1-dev) mode=${MODE} platform=${PLATFORM} force_ios=${FORCE_IOS}"

load_secret() {
  local name="$1"
  local required="${2:-1}"
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
    if [[ "$required" == "1" ]]; then
      echo "Missing $name" >&2
      return 1
    fi
    return 0
  fi
  printf -v "$name" '%s' "$value"
  export "$name"
}

load_dotenv() {
  local file="$1" line name value first last
  [[ -f "$file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    line="${line%"${line##*[![:space:]]}"}"
    [[ -n "$line" ]] || continue
    [[ "$line" == \#* ]] && continue
    if [[ "$line" == export[\ $'\t']* ]]; then
      line="${line#export}"
      line="${line#"${line%%[![:space:]]*}"}"
    fi
    case "$line" in
      *=*) ;;
      *) continue ;;
    esac
    name="${line%%=*}"
    value="${line#*=}"
    name="${name%"${name##*[![:space:]]}"}"
    value="${value#"${value%%[![:space:]]*}"}"
    if [[ ${#value} -ge 2 ]]; then
      first="${value:0:1}"
      last="${value:$((${#value} - 1)):1}"
      if [[ "$first" == "$last" && ( "$first" == '"' || "$first" == "'" ) ]]; then
        value="${value:1:$((${#value} - 2))}"
      fi
    fi
    [[ -n "$name" ]] || continue
    printf -v "$name" '%s' "$value"
    export "$name"
  done < "$file"
}

helper=""
for candidate in \
  "/opt/homebrew/etc/buildkite-agent/checkout-origin.sh" \
  "scripts/fork/checkout-origin.sh"; do
  if [[ -x "$candidate" ]]; then
    helper="$candidate"
    break
  fi
done
if [[ -n "$helper" ]]; then
  "$helper" "${BUILDKITE_COMMIT:-$(git rev-parse HEAD)}" --full ||
    echo "checkout-origin failed; keeping current tree"
fi

git fetch --unshallow || true
if ! git rev-parse --verify --quiet HEAD~1 >/dev/null; then
  git fetch --deepen=50 || git fetch origin --deepen=50 || true
fi
git checkout -- apps/mobile/eas.json 2>/dev/null || true

if [[ "${T3CODE_MOBILE_SKIP_PATH_FILTER:-}" != "1" && "$MODE" != "build" && "$FORCE_IOS" != "true" ]]; then
  if ! git rev-parse --verify --quiet HEAD~1 >/dev/null; then
    echo "No parent commit after deepen; refusing to publish OTA without a path diff." >&2
    exit 1
  fi
  if git diff --quiet HEAD~1 HEAD -- \
    apps/mobile \
    packages \
    patches \
    pnpm-lock.yaml \
    scripts/fork/publish-mobile-release.sh \
    scripts/fork/resolve-ios-native-build.mjs \
    scripts/fork/security-eas-local-keychain; then
    echo "Push does not change mobile-relevant paths; skipping OTA and TestFlight."
    exit 0
  fi
fi

lockdir="/tmp/t3-pretty-ios-mobile.lock"
while ! mkdir "$lockdir" 2>/dev/null; do
  echo "Waiting for another ios-mobile publish on this Mac..."
  sleep 10
done
tmp=""
eas_json="$root/apps/mobile/eas.json"
eas_json_bak=""
cleanup() {
  if [[ -n "${eas_json_bak:-}" && -f "$eas_json_bak" ]]; then
    cp "$eas_json_bak" "$eas_json"
  fi
  if [[ -n "${tmp:-}" ]]; then
    rm -rf "$tmp"
  fi
  rmdir "$lockdir" 2>/dev/null || true
}
trap cleanup EXIT

if ! load_secret EXPO_TOKEN; then
  echo "EXPO_TOKEN is required to publish OTA that installed TestFlight binaries poll." >&2
  exit 1
fi

if ! command -v vp >/dev/null; then
  echo "vp is required on macos-release to publish mobile OTA." >&2
  exit 1
fi

vp i --filter=@t3tools/mobile... --filter=@t3tools/scripts...

pnpm_version="$(node --print "require('./package.json').packageManager.split('@').pop()")"
export PATH="${HOME}/.vite-plus/package_manager/pnpm/${pnpm_version}/pnpm/bin:${PATH}"

if ! command -v npm >/dev/null; then
  echo "npm is required on macos-release to install eas-cli." >&2
  exit 1
fi
if ! command -v eas >/dev/null; then
  npm install -g eas-cli
fi
export PATH="$(npm prefix -g)/bin:${PATH}"
command -v eas
eas --version

(
  cd apps/mobile
  eas env:pull production --path ../../.env.local --non-interactive
)
load_dotenv "$root/.env.local"

tmp="${TMPDIR:-/tmp}/t3-mobile-release-$$"
mkdir -p "$tmp"
restore_eas_json() {
  if [[ -n "${eas_json_bak:-}" && -f "$eas_json_bak" ]]; then
    cp "$eas_json_bak" "$eas_json"
  fi
}

if [[ "$MODE" == "update" || "$MODE" == "release" ]]; then
  update_platform="$PLATFORM"
  if [[ "$MODE" == "release" ]]; then
    update_platform=all
  fi
  (
    cd apps/mobile
    eas update \
      --channel production \
      --environment production \
      --platform "$update_platform" \
      --message "$update_message" \
      --non-interactive
  )
  echo "Published production OTA for ${update_platform}."
fi

if [[ "$MODE" != "build" && "$MODE" != "release" ]]; then
  exit 0
fi

fingerprint_file="$tmp/ios-fingerprint.json"
builds_file="$tmp/ios-builds.json"
gate_file="$tmp/ios-gate.txt"
should_build=false
fingerprint=""

(
  cd apps/mobile
  if ! eas fingerprint:generate \
    --platform ios \
    --build-profile production \
    --json \
    --non-interactive > "$fingerprint_file"; then
    echo "Could not generate the iOS fingerprint; building a native binary to be safe."
    printf 'placeholder\n' > "$fingerprint_file"
    printf 'should_build=true\nfingerprint=unknown\n' > "$gate_file"
    exit 0
  fi
  if ! eas build:list \
    --platform ios \
    --build-profile production \
    --distribution store \
    --limit 20 \
    --json \
    --non-interactive > "$builds_file"; then
    echo "[]" > "$builds_file"
  fi
)

if [[ ! -f "$gate_file" ]]; then
  submitted_fingerprint=""
  if [[ -f .t3-fork/ios-production-fingerprint ]]; then
    submitted_fingerprint="$(tr -d '[:space:]' < .t3-fork/ios-production-fingerprint)"
  fi
  force_flag=false
  if [[ "$MODE" == "build" || "$FORCE_IOS" == "true" ]]; then
    force_flag=true
  fi
  export GITHUB_OUTPUT="$gate_file"
  node scripts/fork/resolve-ios-native-build.mjs \
    --fingerprint-file "$fingerprint_file" \
    --builds-file "$builds_file" \
    --submitted-fingerprint "$submitted_fingerprint" \
    --force "$force_flag"
fi
if ! grep -q '^should_build=' "$gate_file"; then
  echo "iOS native-build gate did not write should_build." >&2
  cat "$gate_file" >&2 || true
  exit 1
fi
should_build="$(awk -F= '/^should_build=/ { print $2 }' "$gate_file" | tail -n 1)"
fingerprint="$(awk -F= '/^fingerprint=/ { print $2 }' "$gate_file" | tail -n 1)"

echo "iOS native binary fingerprint=${fingerprint:-unknown} should_build=${should_build}"

if [[ "$should_build" != "true" ]]; then
  echo "Native fingerprint is unchanged; TestFlight already has this binary. OTA covers JS."
  exit 0
fi

load_secret APPLE_API_KEY
load_secret APPLE_API_KEY_ID
load_secret APPLE_API_ISSUER
load_secret APPLE_TEAM_ID 0
export APPLE_TEAM_ID="${APPLE_TEAM_ID:-78A5P57U23}"
export T3CODE_APPLE_TEAM_ID="${T3CODE_APPLE_TEAM_ID:-$APPLE_TEAM_ID}"
load_secret CURSOR_API_KEY 0

key_path="$tmp/AuthKey_${APPLE_API_KEY_ID}.p8"
printf '%s' "$APPLE_API_KEY" > "$key_path"
chmod 600 "$key_path"
export EXPO_ASC_API_KEY_PATH="$key_path"
export EXPO_ASC_KEY_ID="$APPLE_API_KEY_ID"
export EXPO_ASC_ISSUER_ID="$APPLE_API_ISSUER"
export EXPO_APPLE_TEAM_ID="$APPLE_TEAM_ID"
export EXPO_APPLE_TEAM_TYPE=INDIVIDUAL

eas_json_bak="$tmp/eas.json.bak"
cp "$eas_json" "$eas_json_bak"
node --input-type=module - "$key_path" "$APPLE_API_KEY_ID" "$APPLE_API_ISSUER" <<'NODE'
import fs from "node:fs";
const [keyPath, keyId, issuer] = process.argv.slice(2);
const easJsonPath = "apps/mobile/eas.json";
const eas = JSON.parse(fs.readFileSync(easJsonPath, "utf8"));
eas.submit ??= {};
eas.submit.production ??= {};
eas.submit.production.ios = {
  ...eas.submit.production.ios,
  ascApiKeyPath: keyPath,
  ascApiKeyId: keyId,
  ascApiKeyIssuerId: issuer,
};
fs.writeFileSync(easJsonPath, `${JSON.stringify(eas, null, 2)}\n`);
NODE

is_full_xcode() {
  [[ -n "$1" && "$1" != *CommandLineTools* && -x "$1/usr/bin/xcodebuild" ]]
}
developer_dir=""
if is_full_xcode "${DEVELOPER_DIR:-}"; then
  developer_dir="$DEVELOPER_DIR"
else
  for app in /Applications/Xcode.app /Applications/Xcode-beta.app /Applications/Xcode*.app; do
    if is_full_xcode "$app/Contents/Developer"; then
      developer_dir="$app/Contents/Developer"
      break
    fi
  done
fi
if [[ -z "$developer_dir" ]]; then
  echo "A full Xcode.app (stable or beta) is required on this runner for local iOS production builds." >&2
  ls -ld /Applications/Xcode*.app 2>/dev/null || echo "No Xcode*.app under /Applications." >&2
  xcode-select -p 2>/dev/null || true
  exit 1
fi
echo "Using Xcode at $developer_dir"
export DEVELOPER_DIR="$developer_dir"
selected="$(xcode-select -p 2>/dev/null || true)"
if [[ "$selected" != "$developer_dir" ]]; then
  if sudo -n xcode-select -s "$developer_dir" 2>/dev/null; then
    echo "Switched xcode-select from ${selected:-none} to $developer_dir"
  else
    echo "xcode-select is ${selected:-unset}; could not switch without passwordless sudo." >&2
    echo "On the runner once: sudo xcode-select -s $developer_dir" >&2
  fi
fi
xcodebuild -version

mkdir -p "$HOME/.cache/t3-pretty-release/cocoapods"
export CP_HOME_DIR="$HOME/.cache/t3-pretty-release/cocoapods"
if ! command -v pod >/dev/null; then
  brew install cocoapods
fi
pod --version
if ! command -v fastlane >/dev/null; then
  brew install fastlane
fi
fastlane --version

security_wrap="$tmp/t3-security-wrap"
mkdir -p "$security_wrap"
cp "$root/scripts/fork/security-eas-local-keychain" "$security_wrap/security"
chmod +x "$security_wrap/security"
export PATH="$security_wrap:$PATH"

ipa_path="$tmp/t3-pretty.ipa"
export EAS_LOCAL_BUILD_ARTIFACTS_DIR="$tmp/eas-artifacts"
mkdir -p "$EAS_LOCAL_BUILD_ARTIFACTS_DIR"

(
  cd apps/mobile
  eas build \
    --platform ios \
    --profile production \
    --local \
    --output "$ipa_path" \
    --non-interactive
)
if [[ ! -f "$ipa_path" ]]; then
  ipa_path="$(find "$EAS_LOCAL_BUILD_ARTIFACTS_DIR" -name '*.ipa' -print -quit)"
fi
test -n "$ipa_path"
test -f "$ipa_path"

(
  cd apps/mobile
  eas submit \
    --platform ios \
    --profile production \
    --path "$ipa_path" \
    --non-interactive
)
echo "Submitted TestFlight IPA $ipa_path"
restore_eas_json

if [[ -z "$fingerprint" || "$fingerprint" == "unknown" ]]; then
  echo "Fingerprint was unknown at compile time; generating after TestFlight submit."
  retry="$tmp/ios-fingerprint-retry.json"
  if (
    cd apps/mobile
    eas fingerprint:generate \
      --platform ios \
      --build-profile production \
      --json \
      --non-interactive > "$retry"
  ); then
    fingerprint="$(node scripts/fork/resolve-ios-native-build.mjs \
      --fingerprint-file "$retry" \
      --builds-json "[]" \
      --submitted-fingerprint "" \
      --force false | awk -F= '/^fingerprint=/ { print $2 }' | tail -n 1)"
  fi
fi
if [[ -z "$fingerprint" || "$fingerprint" == "unknown" ]]; then
  echo "Could not record an iOS fingerprint after TestFlight submit; the next release may compile again." >&2
  exit 0
fi

load_secret CURSOR_API_KEY

mkdir -p .t3-fork
printf '%s\n' "$fingerprint" > .t3-fork/ios-production-fingerprint
git add -- .t3-fork/ios-production-fingerprint
if git diff --cached --quiet -- .t3-fork/ios-production-fingerprint; then
  echo "T3CODE iOS production fingerprint already recorded: $fingerprint"
  exit 0
fi
git config user.name "t3-pretty-mobile[bot]"
git config user.email "t3-pretty-bot@users.noreply.cursor.com"
git commit --no-verify -m "chore(mobile): record iOS production fingerprint"

branch="automation/ios-fingerprint-${fingerprint:0:12}"
git push --force origin "HEAD:refs/heads/$branch"
node scripts/fork/origin-forge.mjs setup-ci
body_path="$tmp/t3-pretty-ios-fingerprint.md"
printf '%s\n' \
  "Records the submitted iOS runtime fingerprint so later JS-only releases can skip a native rebuild." \
  > "$body_path"
node scripts/fork/origin-forge.mjs ensure-pr \
  --base main \
  --head "$branch" \
  --title "chore(mobile): record iOS production fingerprint" \
  --body-file "$body_path"
node scripts/fork/origin-forge.mjs merge-pr --head "$branch" --sha "$(git rev-parse HEAD)"
node scripts/fork/origin-forge.mjs delete-branch --head "$branch"
echo "Recorded .t3-fork/ios-production-fingerprint=$fingerprint"
