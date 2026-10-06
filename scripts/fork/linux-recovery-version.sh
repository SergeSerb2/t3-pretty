#!/usr/bin/env bash

# A Linux-only recovery may finish the already delivered Mac/CLI release.
# Never reuse its version for changed application/dependency code or a
# Linux feed that already published that version.
# The build sources update-feed-version.sh before reading its feed floor;
# this guard shares the manifest parser already loaded by that caller.
t3_resolve_linux_recovery_version() (
  set -euo pipefail
  local version="${T3CODE_LINUX_RECOVERY_VERSION:?}"
  local source_commit="${T3CODE_LINUX_RECOVERY_SOURCE_COMMIT:?}"
  local cli_sha="${T3CODE_LINUX_RECOVERY_CLI_SHA256:?}"
  local nightly="${SYNC_TARGET_UPSTREAM_TAG:?}"
  local feed="${T3CODE_DESKTOP_UPDATE_FEED_URL:?}"
  [[ "$source_commit" =~ ^[0-9a-f]{40}$ ]] || exit 1
  [[ "$cli_sha" =~ ^[0-9a-f]{64}$ ]] || exit 1
  [[ "$nightly" =~ ^v[0-9]+\.[0-9]+\.[0-9]+-nightly\.[0-9]{8}\.[0-9]+$ ]] || exit 1
  local prefix="${nightly%.*}"
  prefix="${prefix#v}."
  [[ "$version" == "$prefix"* ]] || exit 1
  local slot="${version#"$prefix"}"
  [[ "$slot" =~ ^[0-9]+$ ]] || exit 1
  (( 10#$slot / 1000000 == 10#${nightly##*.} )) || exit 1

  git merge-base --is-ancestor "$source_commit" HEAD || exit 1
  git merge-base --is-ancestor "${nightly}^{commit}" "$source_commit" || exit 1
  local application_paths=(apps packages package.json pnpm-lock.yaml pnpm-workspace.yaml \
    ':(exclude)apps/web/src/changelog/changelogData.ts')
  if ! git diff --quiet --cached "$source_commit" -- "${application_paths[@]}" || \
    ! git diff --quiet "$source_commit" -- "${application_paths[@]}"; then
      echo "Linux recovery source differs from the delivered application or dependencies." >&2
      exit 1
  fi
  local untracked
  untracked="$(git ls-files --others --exclude-standard -- "${application_paths[@]}")" || exit 1
  if [[ -n "$untracked" ]]; then
    echo "Linux recovery contains untracked application or dependency files." >&2
    exit 1
  fi

  local tmp
  tmp="$(mktemp -d)" || exit 1
  trap 'rm -rf "$tmp"' EXIT
  curl --fail --silent --show-error --max-time 30 -o "$tmp/mac.yml" "${feed%/}/latest-mac.yml" || exit 1
  [[ "$(t3_read_update_manifest_version "$tmp/mac.yml")" == "$version" ]] || {
    echo "Linux recovery version does not match the delivered Mac release." >&2
    exit 1
  }
  curl --fail --silent --show-error --max-time 30 -o "$tmp/linux.yml" "${feed%/}/latest-linux.yml" || exit 1
  local linux_version
  linux_version="$(t3_read_update_manifest_version "$tmp/linux.yml")" || exit 1
  node - "$linux_version" "$version" <<'NODE' || exit 1
const parts = (version) => {
  const match = /^(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.(\d+)$/.exec(version);
  if (!match) throw new Error("Recovery requires exact nightly feed versions");
  return match.slice(1).map(BigInt);
};
const previous = parts(process.argv[2]);
const requested = parts(process.argv[3]);
for (let i = 0; i < previous.length; i++) {
  if (requested[i] > previous[i]) process.exit(0);
  if (requested[i] < previous[i]) process.exit(1);
}
process.exit(1);
NODE

  local name="t3-${version}.tgz"
  curl --fail --silent --show-error --max-time 30 -o "$tmp/checksum" "${feed%/}/${name}.sha256" || exit 1
  local published_sha ignored
  read -r published_sha ignored < "$tmp/checksum" || exit 1
  [[ "$published_sha" == "$cli_sha" ]] || exit 1
  curl --fail --silent --show-error --max-time 90 --max-filesize 134217728 \
    -o "$tmp/cli.tgz" "${feed%/}/${name}" || exit 1
  node - "$tmp/cli.tgz" "$cli_sha" <<'NODE' || exit 1
const fs = require("node:fs");
const crypto = require("node:crypto");
const actual = crypto.createHash("sha256").update(fs.readFileSync(process.argv[2])).digest("hex");
if (actual !== process.argv[3]) throw new Error("Delivered CLI checksum mismatch");
NODE
  tar -xOzf "$tmp/cli.tgz" package/package.json | node -e '
    let input = "";
    process.stdin.on("data", (chunk) => input += chunk);
    process.stdin.on("end", () => {
      const pkg = JSON.parse(input);
      if (pkg.name !== "t3" || pkg.version !== process.argv[1]) process.exit(1);
    });
  ' "$version" || exit 1
  printf '%s\n' "$version"
)
