#!/usr/bin/env bash
# Native macos-release iOS OTA + TestFlight. Same machine as the signed DMG
# (m5-dev; m1-dev is now Linux). The GitHub Actions importer cannot load
# cluster secrets or keep PATH across steps, so imported Expo/EAS jobs die
# in seconds and TestFlight
# never sees the update.
#
# Installed TestFlight binaries already poll the fork Expo Updates URL baked
# into the IPA. Default release is that JS channel (`eas update`). A new IPA
# is only compiled when the native fingerprint changed, or a maintainer set
# T3CODE_FORCE_IOS / T3CODE_MOBILE_MODE=build. eas submit queues that IPA for
# TestFlight through App Store Connect; it does not submit the app for App
# Store review. EAS owns the remote retry after accepting the submission, so
# Buildkite does not wait on that queue while holding the Apple signing slot.
# Local builds use stable Xcode;
# beta toolchains can fall out of App Store Connect support without warning,
# so the existing EAS cloud path handles IPA builds while this Mac is on beta.
#
# Buildkite cancels intermediate main builds when pushes land in quick
# succession, so a release can die mid-flight and a later push would skip on
# its own empty HEAD~1 diff. The runner records each published OTA commit in
# ~/.cache/t3-pretty-release/ios-ota-publish and diffs against it instead, so
# the next uncancelled build re-releases everything stranded. A skip only
# silences the OTA; the native fingerprint gate always runs, so a due IPA
# still compiles even when the JS bundle is unchanged.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
# shellcheck source=apple-signing-lock.sh
source "$root/scripts/fork/apple-signing-lock.sh"

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
NATIVE_SUBMIT_MARK=".t3-fork/ios-native-submit"
LOCAL_SUBMIT_MARK="${HOME}/.cache/t3-pretty-release/ios-native-submit"
# Runner-local record of the last commit whose OTA actually published.
# Buildkite cancels intermediate main builds, so a release can die
# mid-flight; the next push then used to skip on its own empty HEAD~1
# diff and strand the release for good. Diffing against this mark lets a
# later build re-release everything since the last publish.
LOCAL_OTA_MARK="${HOME}/.cache/t3-pretty-release/ios-ota-publish"
case "${T3CODE_FORCE_IOS:-}" in
  true | TRUE | 1 | yes | YES) FORCE_IOS=true ;;
esac

commit="${BUILDKITE_COMMIT:-${GITHUB_SHA:-$(git rev-parse HEAD)}}"
update_message="${T3CODE_MOBILE_UPDATE_MESSAGE:-Production OTA (${commit})}"

echo "T3 Pretty mobile release on macos-release (m5-dev) mode=${MODE} platform=${PLATFORM} force_ios=${FORCE_IOS}"

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

annotate() {
  local style="${1:-info}"
  shift
  local body="$*"
  echo "$body"
  if command -v buildkite-agent >/dev/null; then
    buildkite-agent annotate --style "$style" --context ios-mobile "$body" || true
  fi
}

native_submit_line() {
  local file="$1"
  [[ -f "$file" ]] || return 1
  head -n 1 "$file" 2>/dev/null | tr -d '[:space:]'
}

# Diff base for the mobile path filter. Prints "covered" when the recorded
# OTA matches this commit or is newer (a faster job already released a later
# SHA; this older build's bundle would regress the production channel), the
# recorded commit when it is an ancestor of HEAD, "HEAD~1" when the runner
# has no record yet, and "changed" when the record fell off the shallow
# boundary (too many pushes to prove coverage, so treat the release as due).
mobile_release_base() {
  local mark
  mark="$(native_submit_line "$LOCAL_OTA_MARK" || true)"
  if [[ "$mark" == "$commit" ]]; then
    printf 'covered\n'
  elif [[ "$mark" =~ ^[0-9a-f]{40}$ ]]; then
    if git merge-base --is-ancestor "$mark" HEAD 2>/dev/null; then
      printf '%s\n' "$mark"
    elif git merge-base --is-ancestor HEAD "$mark" 2>/dev/null; then
      printf 'covered\n'
    else
      printf 'changed\n'
    fi
  elif [[ -z "$mark" ]]; then
    printf 'HEAD~1\n'
  else
    printf 'changed\n'
  fi
}

record_local_native_submit() {
  mkdir -p "$(dirname "$LOCAL_SUBMIT_MARK")"
  printf '%s\n' "macos-release" "${1:-${commit:-unknown}}" > "$LOCAL_SUBMIT_MARK"
}

record_local_ota_publish() {
  local existing next="${1:-$commit}"
  # Both macos-release agents and the upstream-sync job share this file.
  # Advance only when the recorded commit is provably older: a slower job on
  # an older SHA — or a shallow clone that cannot resolve the mark — must
  # not regress it, or the next push would re-diff (and re-publish) content
  # already released.
  existing="$(native_submit_line "$LOCAL_OTA_MARK" || true)"
  if [[ "$existing" =~ ^[0-9a-f]{40}$ && "$existing" != "$next" ]] \
    && ! git merge-base --is-ancestor "$existing" "$next" 2>/dev/null; then
    echo "Recorded OTA commit $existing is not behind $next; keeping it."
    return 0
  fi
  mkdir -p "$(dirname "$LOCAL_OTA_MARK")"
  printf '%s\n' "$next" > "$LOCAL_OTA_MARK"
}

# One successful macos-release TestFlight submit is enough. The git marker
# lands through a follow-up PR, so queued jobs on older SHAs would otherwise
# each compile another 50–90 minute IPA on the only Mac agent.
native_submit_recorded() {
  local first
  first="$(native_submit_line "$NATIVE_SUBMIT_MARK" || true)"
  if [[ "$first" == "macos-release" ]]; then
    return 0
  fi
  first="$(native_submit_line "$LOCAL_SUBMIT_MARK" || true)"
  if [[ "$first" == "macos-release" ]]; then
    echo "Runner already submitted a TestFlight IPA; not compiling another."
    return 0
  fi
  first="$(git show "origin/main:${NATIVE_SUBMIT_MARK}" 2>/dev/null | head -n 1 | tr -d '[:space:]' || true)"
  if [[ "$first" == "macos-release" ]]; then
    echo "origin/main already records a macos-release TestFlight submit; not compiling another."
    record_local_native_submit "origin/main"
    return 0
  fi
  return 1
}

# Upstream sync already has the merged tree. Re-checking out BUILDKITE_COMMIT
# would reset to the scheduled starting SHA and publish a stale OTA.
if [[ "${T3CODE_MOBILE_SKIP_PATH_FILTER:-}" != "1" ]]; then
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
fi

# Do not unshallow this checkout. The workspace is reused across jobs and
# downloading the whole Origin history occupies the only macos-release agent.
# checkout-origin --full still respects an existing shallow boundary, so fetch
# 50 commits of this SHA and origin/main: the path filter needs HEAD~1 and
# the recorded OTA commit, and native_submit_recorded reads the marker from
# origin/main. Never fetch --depth=1 afterward. That shortens the clone back
# to one commit and the path filter then fails closed on every main push.
git fetch --depth=50 origin "${commit}" main ||
  git fetch --depth=50 origin main ||
  git fetch --deepen=50 origin "${commit}" ||
  git fetch --deepen=50 ||
  true
git checkout -- apps/mobile/eas.json 2>/dev/null || true

# A skip only silences the OTA; the native fingerprint gate below still runs,
# so an IPA that a cancelled build never compiled is not stranded with it.
mobile_changed=true
if [[ "${T3CODE_MOBILE_SKIP_PATH_FILTER:-}" != "1" && "$MODE" != "build" && "$FORCE_IOS" != "true" ]]; then
  base="$(mobile_release_base)"
  case "$base" in
    covered)
      mobile_changed=false
      ;;
    changed)
      ;;
    *)
      if ! git rev-parse --verify --quiet "$base" >/dev/null; then
        echo "No parent commit after history fetch; refusing to publish OTA without a path diff." >&2
        exit 1
      fi
      if git diff --quiet "$base" HEAD -- \
        apps/mobile \
        packages \
        patches \
        pnpm-lock.yaml \
        scripts/fork/publish-mobile-release.sh \
        scripts/fork/resolve-ios-native-build.mjs \
        scripts/fork/security-eas-local-keychain; then
        mobile_changed=false
        # HEAD's mobile content now provably matches a published commit.
        # Advance the mark so the next push diffs against something recent.
        # The HEAD~1 fallback proves nothing about coverage; leave the mark.
        [[ "$base" == "HEAD~1" ]] || record_local_ota_publish
      fi
      ;;
  esac
fi

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
  apple_signing_lock_release
}
trap cleanup EXIT
apple_signing_lock_acquire

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

configure_eas_build_fingerprint() {
  local expected_fingerprint="$1"
  export EXPO_UPDATES_FINGERPRINT_OVERRIDE="$expected_fingerprint"
  node --input-type=module - "$eas_json" "$expected_fingerprint" <<'NODE'
import fs from "node:fs";
const [easJsonPath, expectedFingerprint] = process.argv.slice(2);
const eas = JSON.parse(fs.readFileSync(easJsonPath, "utf8"));
eas.build ??= {};
eas.build.production ??= {};
eas.build.production.env = {
  ...eas.build.production.env,
  EXPO_UPDATES_FINGERPRINT_OVERRIDE: expectedFingerprint,
};
fs.writeFileSync(easJsonPath, `${JSON.stringify(eas, null, 2)}\n`);
NODE
}

configure_eas_submit_credentials() {
  local key_path="$1"
  local key_id="$2"
  local issuer="$3"
  node --input-type=module - "$eas_json" "$key_path" "$key_id" "$issuer" <<'NODE'
import fs from "node:fs";
const [easJsonPath, keyPath, keyId, issuer] = process.argv.slice(2);
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
}

read_eas_cloud_build_details() {
  local cloud_build_json="$1"
  node --input-type=module - "$cloud_build_json" <<'NODE'
import fs from "node:fs";
const raw = fs.readFileSync(process.argv[2], "utf8").trim();
let data;
try {
  data = JSON.parse(raw);
} catch {
  const jsonStart = /^[\[{]/mu.exec(raw)?.index ?? -1;
  if (jsonStart < 0) {
    throw new Error("eas build --json did not emit JSON");
  }
  data = JSON.parse(raw.slice(jsonStart));
}
const build = Array.isArray(data) ? data[data.length - 1] : data;
const id = typeof build?.id === "string" ? build.id : "";
const artifactUrl =
  typeof build?.artifacts?.applicationArchiveUrl === "string"
    ? build.artifacts.applicationArchiveUrl
    : typeof build?.artifacts?.buildUrl === "string"
      ? build.artifacts.buildUrl
      : "";
if (!id) {
  throw new Error("eas build --json did not include a build id");
}
if (!artifactUrl) {
  throw new Error("eas build --json did not include an application archive URL");
}
process.stdout.write(`${id}\n${artifactUrl}\n`);
NODE
}

verify_ipa_fingerprint() {
  local ipa_path="$1"
  local expected_fingerprint="$2"
  local fingerprint_entry
  local embedded_fingerprint
  if ! command -v unzip >/dev/null; then
    echo "unzip is required to verify the iOS runtime fingerprint before TestFlight submit." >&2
    return 1
  fi
  if [[ ! -f "$ipa_path" ]]; then
    echo "Cannot verify iOS runtime fingerprint: IPA is missing at $ipa_path." >&2
    return 1
  fi
  fingerprint_entry="$({ unzip -Z1 "$ipa_path" 2>/dev/null || true; } | awk '
    /^Payload\/[^\/]+\.app\/EXUpdates\.bundle\/fingerprint$/ && !entry { entry = $0 }
    END { print entry }
  ')"
  if [[ -z "$fingerprint_entry" ]]; then
    echo "Cannot verify iOS runtime fingerprint: EXUpdates.bundle/fingerprint is missing." >&2
    return 1
  fi
  embedded_fingerprint="$(unzip -p "$ipa_path" "$fingerprint_entry" 2>/dev/null | tr -d '[:space:]')"
  if [[ -z "$embedded_fingerprint" ]]; then
    echo "Cannot verify iOS runtime fingerprint: embedded fingerprint is empty." >&2
    return 1
  fi
  if [[ "$embedded_fingerprint" != "$expected_fingerprint" ]]; then
    echo "Embedded iOS runtime fingerprint mismatch: expected $expected_fingerprint, got $embedded_fingerprint. Refusing TestFlight submit." >&2
    return 1
  fi
  printf '%s\n' "$embedded_fingerprint"
}

if [[ "$MODE" == "update" || "$MODE" == "release" ]]; then
  # The path filter ran before the publish lock; a newer job may have
  # released while this one waited on it. Re-check coverage with the lock
  # held so a stale bundle never lands on top of a newer one.
  if [[ "$mobile_changed" == "true" && "${T3CODE_MOBILE_SKIP_PATH_FILTER:-}" != "1" && "$FORCE_IOS" != "true" ]] \
    && [[ "$(mobile_release_base)" == "covered" ]]; then
    mobile_changed=false
  fi
  if [[ "$mobile_changed" == "true" ]]; then
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
    record_local_ota_publish
  else
    echo "Production OTA already covers mobile content at ${commit}; skipping eas update."
  fi
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
  # One retry before a flake gets to decide a 50-minute compile (or skip a
  # due one). Two failures in a row are environmental, not network.
  fingerprint_attempts=0
  while ! eas fingerprint:generate \
    --platform ios \
    --build-profile production \
    --json \
    --non-interactive > "$fingerprint_file"; do
    fingerprint_attempts=$((fingerprint_attempts + 1))
    if (( fingerprint_attempts >= 2 )); then
      echo "Could not generate a stable iOS fingerprint; refusing a native build." >&2
      exit 1
    fi
    echo "iOS fingerprint generation flaked; retrying once."
    sleep 10
  done
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
  submitted_fingerprint_file="$tmp/ios-submitted-fingerprint"
  if [[ -f .t3-fork/ios-production-fingerprint ]]; then
    cp .t3-fork/ios-production-fingerprint "$submitted_fingerprint_file"
  else
    : > "$submitted_fingerprint_file"
  fi
  # Trust the recorded fingerprint, including one left by the old GitHub
  # Actions importer. Installed TestFlight binaries pick up JS via OTA.
  # Do not force an IPA upload just because this native job has never
  # written .t3-fork/ios-native-submit.
  force_flag=false
  if [[ "$MODE" == "build" || "$FORCE_IOS" == "true" ]]; then
    force_flag=true
  fi
  export GITHUB_OUTPUT="$gate_file"
  node scripts/fork/resolve-ios-native-build.mjs \
    --fingerprint-file "$fingerprint_file" \
    --builds-file "$builds_file" \
    --submitted-fingerprint-file "$submitted_fingerprint_file" \
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
  annotate info "Native fingerprint is unchanged; TestFlight.app will not get a new build. Installed binaries pick up JS via OTA."
  exit 0
fi
if [[ -z "$fingerprint" || "$fingerprint" == "unknown" ]]; then
  annotate error "A stable iOS runtime fingerprint is required before compiling or submitting TestFlight. Refusing an unverifiable build."
  exit 1
fi

is_full_xcode() {
  [[ -n "$1" && "$1" != *CommandLineTools* && -x "$1/usr/bin/xcodebuild" ]] || return 1
  # leftover Xcode.app on macOS 27 can exist without being runnable.
  local version_output
  if ! version_output="$(DEVELOPER_DIR="$1" "$1/usr/bin/xcodebuild" -version 2>/dev/null)"; then
    echo "Skipping $1: xcodebuild -version failed." >&2
    return 1
  fi
  if [[ "$1" == *Xcode-beta.app* || -f "$1/../Resources/BetaVersion.plist" ]]; then
    local accepted_beta_build="${T3CODE_ACCEPTED_XCODE_BETA_BUILD:-27A5252f}"
    local beta_build
    beta_build="$(sed -n 's/^Build version //p' <<< "$version_output" | head -n 1)"
    if [[ "$beta_build" != "$accepted_beta_build" ]]; then
      echo "Skipping $1: beta build ${beta_build:-unknown}; accepted beta is $accepted_beta_build." >&2
      return 1
    fi
  fi
  return 0
}

# Prefer a stable full Xcode.app if xcodebuild actually runs. Command Line
# Tools cannot compile an IPA. The current Apple-listed beta is accepted for
# macOS developer builds; stale betas fall back to EAS cloud.
# Override T3CODE_ACCEPTED_XCODE_BETA_BUILD when Apple advances the listed beta.
# Origin's pipeline upload rejects `interruptible`, so a later main push
# can still cancel this job. Do not merge unrelated main PRs during an IPA.
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

ipa_via_cloud=false
if ! is_full_xcode "$developer_dir"; then
  ipa_via_cloud=true
  ls -ld /Applications/Xcode*.app 2>/dev/null || echo "No Xcode*.app under /Applications."
  xcode-select -p 2>/dev/null || true
  annotate info "No full Xcode on this Mac that is safe for App Store Connect. Compiling the TestFlight IPA on EAS cloud."
fi
if ! command -v unzip >/dev/null; then
  echo "unzip is required to verify the iOS runtime fingerprint before TestFlight submit." >&2
  exit 1
fi
if [[ "$ipa_via_cloud" == "true" ]] && ! command -v curl >/dev/null; then
  echo "curl is required to verify an EAS cloud IPA before TestFlight submit." >&2
  exit 1
fi

load_secret APPLE_API_KEY
load_secret APPLE_API_KEY_ID
load_secret APPLE_API_ISSUER
load_secret APPLE_TEAM_ID 0
export APPLE_TEAM_ID="${APPLE_TEAM_ID:-78A5P57U23}"
export T3CODE_APPLE_TEAM_ID="${T3CODE_APPLE_TEAM_ID:-$APPLE_TEAM_ID}"
load_secret CURSOR_API_KEY 0

# EAS Build can use this API key to create or refresh signing credentials in
# non-interactive mode. Keep it in the process environment for the build, but
# do not add its randomized path to fingerprinted eas.json until submission.
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
configure_eas_build_fingerprint "$fingerprint"

ipa_path="$tmp/t3-pretty.ipa"
build_source="local Xcode"

if [[ "$ipa_via_cloud" == "true" ]]; then
  cloud_build_json="$tmp/eas-cloud-build.json"
  (
    cd apps/mobile
    eas build \
      --platform ios \
      --profile production \
      --non-interactive \
      --wait \
      --json > "$cloud_build_json"
  )
  cloud_build_details="$tmp/eas-cloud-build-details"
  read_eas_cloud_build_details "$cloud_build_json" > "$cloud_build_details"
  build_id="$(sed -n '1p' "$cloud_build_details")"
  artifact_url="$(sed -n '2p' "$cloud_build_details")"
  curl --fail --location --retry 3 --output "$ipa_path" "$artifact_url"
  build_source="EAS cloud build $build_id"
else
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
  # Homebrew 5 prompts on a TTY before installing deps; the LaunchAgent has one.
  export HOMEBREW_NO_ASK=1
  export HOMEBREW_NO_AUTO_UPDATE=1
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
fi

verified_fingerprint=""
if ! verified_fingerprint="$(verify_ipa_fingerprint "$ipa_path" "$fingerprint")"; then
  annotate error "The $build_source IPA does not embed the OTA runtime fingerprint. TestFlight submit was blocked."
  exit 1
fi
fingerprint="$verified_fingerprint"
echo "Verified embedded iOS runtime fingerprint=$fingerprint in $build_source IPA."

# Submission profile credentials are intentionally added only after the IPA is built.
# eas.json is a native fingerprint source, and the temporary key path changes
# on every run; adding it before the build makes the binary reject its own OTA.
configure_eas_submit_credentials "$key_path" "$APPLE_API_KEY_ID" "$APPLE_API_ISSUER"

# Fastlane pilot uploads a TestFlight build. This is not App Store review.
(
  cd apps/mobile
  eas submit \
    --platform ios \
    --profile production \
    --path "$ipa_path" \
    --no-wait \
    --non-interactive
)
record_local_native_submit "$commit"
if [[ "$ipa_via_cloud" == "true" ]]; then
  annotate success "Submitted verified TestFlight IPA from EAS cloud build $build_id"
else
  annotate success "Submitted verified TestFlight IPA $ipa_path"
fi
restore_eas_json

if ! load_secret CURSOR_API_KEY; then
  echo "CURSOR_API_KEY is missing; TestFlight already submitted. Skipping the fingerprint record PR." >&2
  exit 0
fi

mkdir -p .t3-fork
printf '%s\n' "$fingerprint" > .t3-fork/ios-production-fingerprint
printf '%s\n' "macos-release" "$commit" > "$NATIVE_SUBMIT_MARK"
git add -- .t3-fork/ios-production-fingerprint "$NATIVE_SUBMIT_MARK"
if git diff --cached --quiet -- .t3-fork/ios-production-fingerprint "$NATIVE_SUBMIT_MARK"; then
  echo "T3CODE iOS production fingerprint already recorded: $fingerprint"
  exit 0
fi
git config user.name "t3-pretty-mobile[bot]"
git config user.email "t3-pretty-bot@users.noreply.cursor.com"
git commit --no-verify -m "chore(mobile): record iOS production fingerprint"

branch="automation/ios-fingerprint-${fingerprint:0:12}"
git push --force origin "HEAD:refs/heads/$branch" || {
  echo "Fingerprint branch push failed; retrying once."
  sleep 5
  git push --force origin "HEAD:refs/heads/$branch"
}
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
