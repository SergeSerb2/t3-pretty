#!/usr/bin/env bash
# Build and submit one T3 Pretty Android flavor to Google Play's internal
# testing track. Internal releases run automatically once their setup flag is
# present; public releases are explicit Buildkite UI builds.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"

export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:${HOME}/.vite-plus/bin:${HOME}/.local/bin:${PATH}"
export APP_VARIANT=production
export NODE_OPTIONS="${NODE_OPTIONS:---max-old-space-size=8192}"

flavor="${T3CODE_ANDROID_RELEASE_FLAVOR:-internal}"
case "$flavor" in
  internal | public) ;;
  *)
    echo "T3CODE_ANDROID_RELEASE_FLAVOR must be internal or public." >&2
    exit 1
    ;;
esac
export T3CODE_BUILD_FLAVOR="$flavor"

context="android-${flavor}-mobile"
annotate() {
  local style="$1"
  shift
  echo "$*"
  if command -v buildkite-agent >/dev/null; then
    buildkite-agent annotate --style "$style" --context "$context" "$*" || true
  fi
}

# Buildkite secrets stay on the release host or in its cluster store. Public
# EAS identifiers are not secrets, but loading them here lets setup add them
# without another source change.
# shellcheck source=load-buildkite-secrets.sh
. "$root/scripts/fork/load-buildkite-secrets.sh" \
  EXPO_TOKEN \
  CURSOR_API_KEY \
  T3CODE_INTERNAL_ANDROID_RELEASE_ENABLED \
  T3CODE_PUBLIC_MOBILE_EAS_PROJECT_ID \
  T3CODE_PUBLIC_MOBILE_EXPO_OWNER \
  T3CODE_PUBLIC_MOBILE_EXPO_SLUG

if [[ "$flavor" == "internal" ]]; then
  if [[ "${T3CODE_INTERNAL_ANDROID_RELEASE_ENABLED:-}" != "1" ]]; then
    annotate warning "Internal Android delivery is wired but inactive. Create the Play app, upload its service-account key to EAS, then set T3CODE_INTERNAL_ANDROID_RELEASE_ENABLED=1 on macos-release."
    exit 0
  fi
  export T3CODE_MOBILE_EAS_PROJECT_ID="${T3CODE_MOBILE_EAS_PROJECT_ID:-1eb51d67-48c5-4100-8aa8-f5ac9e1ada65}"
  export T3CODE_MOBILE_EXPO_OWNER="${T3CODE_MOBILE_EXPO_OWNER:-sergeserbinenkoteam}"
  export T3CODE_MOBILE_EXPO_SLUG="${T3CODE_MOBILE_EXPO_SLUG:-t3-pretty}"
else
  export T3CODE_MOBILE_EAS_PROJECT_ID="${T3CODE_PUBLIC_MOBILE_EAS_PROJECT_ID:-}"
  export T3CODE_MOBILE_EXPO_OWNER="${T3CODE_PUBLIC_MOBILE_EXPO_OWNER:-}"
  export T3CODE_MOBILE_EXPO_SLUG="${T3CODE_PUBLIC_MOBILE_EXPO_SLUG:-}"
  # The public app always uses official T3 Connect, even on a release host
  # whose repository defaults select the private Internal environment.
  export T3CODE_CLERK_PUBLISHABLE_KEY="pk_live_Y2xlcmsudDMuY29kZXMk"
  export T3CODE_CLERK_JWT_TEMPLATE="t3-relay"
  export T3CODE_CLERK_CLI_OAUTH_CLIENT_ID="hzxSgY2cH10sDU2r"
  export T3CODE_RELAY_URL="https://relay.t3.codes"
fi

for name in T3CODE_MOBILE_EAS_PROJECT_ID T3CODE_MOBILE_EXPO_OWNER T3CODE_MOBILE_EXPO_SLUG; do
  if [[ -z "${!name:-}" ]]; then
    echo "$name is required for the $flavor Android release." >&2
    exit 1
  fi
done
export T3CODE_MOBILE_UPDATE_URL="https://u.expo.dev/${T3CODE_MOBILE_EAS_PROJECT_ID}"
selected_eas_project_id="$T3CODE_MOBILE_EAS_PROJECT_ID"
selected_expo_owner="$T3CODE_MOBILE_EXPO_OWNER"
selected_expo_slug="$T3CODE_MOBILE_EXPO_SLUG"

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "EXPO_TOKEN is required for Android build and submission." >&2
  exit 1
fi

commit="${BUILDKITE_COMMIT:-$(git rev-parse HEAD)}"
marker=".t3-fork/android-${flavor}-production-fingerprint"
local_marker="${HOME}/.cache/t3-pretty-release/android-${flavor}-production-fingerprint"
checked_head="${HOME}/.cache/t3-pretty-release/android-${flavor}-checked-head"

git fetch --depth=50 origin "$commit" main ||
  git fetch --depth=50 origin main ||
  git fetch --deepen=50 origin "$commit" ||
  git fetch --deepen=50 ||
  true

head="$(git rev-parse HEAD)"
latest_main="$(git rev-parse origin/main 2>/dev/null || true)"
if [[ -n "$latest_main" && "$head" != "$latest_main" ]] &&
  git merge-base --is-ancestor "$head" "$latest_main" 2>/dev/null; then
  annotate info "A newer Origin main exists; skipping stale $flavor Android delivery for $head."
  exit 0
fi

if [[ "$flavor" == "internal" && "${T3CODE_FORCE_ANDROID:-}" != "1" ]]; then
  previous="$(head -n 1 "$checked_head" 2>/dev/null | tr -d '[:space:]' || true)"
  if [[ "$previous" =~ ^[0-9a-f]{40}$ ]] && git merge-base --is-ancestor "$previous" HEAD 2>/dev/null; then
    if git diff --quiet "$previous" HEAD -- \
      apps/mobile \
      packages \
      patches \
      pnpm-lock.yaml \
      scripts/fork/publish-android-release.sh \
      scripts/fork/resolve-ios-native-build.mjs; then
      mkdir -p "$(dirname "$checked_head")"
      printf '%s\n' "$head" > "$checked_head"
      annotate info "No Android-relevant changes since the last successful Internal check."
      exit 0
    fi
  fi
fi

if ! command -v vp >/dev/null; then
  echo "vp is required on macos-release to publish Android builds." >&2
  exit 1
fi
vp i --filter=@t3tools/mobile... --filter=@t3tools/scripts...

pnpm_version="$(node --print "require('./package.json').packageManager.split('@').pop()")"
export PATH="${HOME}/.vite-plus/package_manager/pnpm/${pnpm_version}/pnpm/bin:${PATH}"
if ! command -v eas >/dev/null; then
  npm install -g eas-cli
fi
export PATH="$(npm prefix -g)/bin:${PATH}"
eas --version

tmp="$(mktemp -d "${TMPDIR:-/tmp}/t3-pretty-android-release.XXXXXX")"
cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT

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
    [[ "$line" == *=* ]] || continue
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

(
  cd apps/mobile
  eas env:pull production --path "$tmp/eas.env" --non-interactive
)
load_dotenv "$tmp/eas.env"
# The selected identity wins over values stored in an EAS environment shared
# with an older flavor configuration.
export T3CODE_BUILD_FLAVOR="$flavor"
export APP_VARIANT=production
export T3CODE_MOBILE_EAS_PROJECT_ID="$selected_eas_project_id"
export T3CODE_MOBILE_EXPO_OWNER="$selected_expo_owner"
export T3CODE_MOBILE_EXPO_SLUG="$selected_expo_slug"
export T3CODE_MOBILE_UPDATE_URL="https://u.expo.dev/${selected_eas_project_id}"
if [[ "$flavor" == "public" ]]; then
  export T3CODE_CLERK_PUBLISHABLE_KEY="pk_live_Y2xlcmsudDMuY29kZXMk"
  export T3CODE_CLERK_JWT_TEMPLATE="t3-relay"
  export T3CODE_CLERK_CLI_OAUTH_CLIENT_ID="hzxSgY2cH10sDU2r"
  export T3CODE_RELAY_URL="https://relay.t3.codes"
fi

fingerprint_file="$tmp/android-fingerprint.json"
gate_file="$tmp/android-gate.txt"
fingerprint_attempts=0
while ! (
  cd apps/mobile
  eas fingerprint:generate \
    --platform android \
    --build-profile production \
    --json \
    --non-interactive > "$fingerprint_file"
); do
  fingerprint_attempts=$((fingerprint_attempts + 1))
  if (( fingerprint_attempts >= 2 )); then
    echo "Could not generate the Android fingerprint after two attempts." >&2
    exit 1
  fi
  echo "Android fingerprint generation flaked; retrying once."
  sleep 10
done

submitted="$tmp/submitted-fingerprint"
if [[ -f "$local_marker" ]]; then
  cp "$local_marker" "$submitted"
elif [[ -f "$marker" ]]; then
  cp "$marker" "$submitted"
else
  : > "$submitted"
fi

force=false
if [[ "$flavor" == "public" || "${T3CODE_FORCE_ANDROID:-}" == "1" ]]; then
  force=true
fi
GITHUB_OUTPUT="$gate_file" node scripts/fork/resolve-ios-native-build.mjs \
  --platform android \
  --fingerprint-file "$fingerprint_file" \
  --submitted-fingerprint-file "$submitted" \
  --force "$force"

if ! grep -q '^should_build=' "$gate_file"; then
  echo "Android native-build gate did not write should_build." >&2
  exit 1
fi
should_build="$(awk -F= '/^should_build=/ { print $2 }' "$gate_file" | tail -n 1)"
fingerprint="$(awk -F= '/^fingerprint=/ { print $2 }' "$gate_file" | tail -n 1)"

if [[ "$should_build" != "true" ]]; then
  mkdir -p "$(dirname "$checked_head")"
  printf '%s\n' "$head" > "$checked_head"
  annotate info "$flavor Android fingerprint is unchanged; installed builds receive compatible JavaScript through Expo Updates."
  exit 0
fi

build_json="$tmp/eas-build.json"
(
  cd apps/mobile
  eas build \
    --platform android \
    --profile production \
    --non-interactive \
    --wait \
    --json > "$build_json"
)
build_id="$(
  node --input-type=module - "$build_json" <<'NODE'
import fs from "node:fs";
const raw = fs.readFileSync(process.argv[2], "utf8").trim();
let data;
try {
  data = JSON.parse(raw);
} catch {
  const start = Math.max(raw.lastIndexOf("\n{") + 1, raw.lastIndexOf("{"));
  data = JSON.parse(raw.slice(start));
}
const build = Array.isArray(data) ? data[data.length - 1] : data;
if (typeof build?.id !== "string" || build.id.length === 0) {
  throw new Error("eas build --json did not include a build id");
}
process.stdout.write(`${build.id}\n`);
NODE
)"

(
  cd apps/mobile
  eas submit \
    --platform android \
    --profile production \
    --id "$build_id" \
    --non-interactive
)

mkdir -p "$(dirname "$local_marker")"
printf '%s\n' "$fingerprint" > "$local_marker"
printf '%s\n' "$head" > "$checked_head"
annotate success "Submitted T3 Pretty ${flavor} Android build to Google Play internal testing."

if [[ -z "${CURSOR_API_KEY:-}" ]]; then
  echo "CURSOR_API_KEY is missing; Android submitted successfully, but its fingerprint marker was not recorded on Origin." >&2
  exit 0
fi

mkdir -p .t3-fork
printf '%s\n' "$fingerprint" > "$marker"
git add -- "$marker"
if git diff --cached --quiet -- "$marker"; then
  exit 0
fi

git config user.name "t3-pretty-mobile[bot]"
git config user.email "t3-pretty-bot@users.noreply.cursor.com"
git commit --no-verify -m "chore(mobile): record ${flavor} Android fingerprint"
branch="automation/android-${flavor}-fingerprint-${fingerprint:0:12}"
git push --force origin "HEAD:refs/heads/$branch"
node scripts/fork/origin-forge.mjs setup-ci
body="$tmp/android-fingerprint.md"
printf '%s\n' \
  "Records the submitted ${flavor} Android runtime fingerprint as release evidence. Later compatible releases can then avoid rebuilding the Play binary." \
  > "$body"
node scripts/fork/origin-forge.mjs ensure-pr \
  --base main \
  --head "$branch" \
  --title "chore(mobile): record ${flavor} Android fingerprint" \
  --body-file "$body"
node scripts/fork/origin-forge.mjs merge-pr --head "$branch" --sha "$(git rev-parse HEAD)"
node scripts/fork/origin-forge.mjs delete-branch --head "$branch"
