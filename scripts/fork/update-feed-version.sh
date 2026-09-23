#!/usr/bin/env bash
# Parse public desktop updater YAML versions. Hosted linux-small floors the
# fork build slot from latest-linux.yml / latest-mac.yml / latest.yml before
# Node is on PATH, so this stays bash. Quote rules match parseScalarValue in
# scripts/lib/update-manifest.ts (single-quoted scalars, '' escapes) and also
# drop a matching double-quote wrap. Source this file, or run:
#   bash scripts/fork/update-feed-version.sh --print-version FILE
#   bash scripts/fork/update-feed-version.sh --dir DIR
#   T3CODE_DESKTOP_UPDATE_FEED_URL=... bash scripts/fork/update-feed-version.sh
if [[ "${BASH_SOURCE[0]-}" == "${0-}" ]]; then
  set -euo pipefail
fi

# Trim CR/whitespace and YAML quotes from one scalar.
t3_unquote_yaml_scalar() {
  local value="${1-}"
  value="${value%$'\r'}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ ${#value} -ge 2 && "$value" == \'*\' ]]; then
    value="${value#\'}"
    value="${value%\'}"
    value="${value//\'\'/\'}"
  elif [[ ${#value} -ge 2 && "$value" == \"*\" ]]; then
    value="${value#\"}"
    value="${value%\"}"
  fi
  printf '%s' "$value"
}

# Print the top-level version: field from an electron-builder / T3 feed file.
t3_read_update_manifest_version() {
  local raw
  raw="$(sed -n 's/^version: *//p' "$1" | head -n 1)"
  t3_unquote_yaml_scalar "$raw"
}

# Print the nightly build slot (digits after -nightly.YYYYMMDD.).
t3_nightly_build_slot() {
  local version="$1"
  if [[ ! "$version" =~ -nightly\.[0-9]{8}\.([0-9]+)$ ]]; then
    return 1
  fi
  printf '%s' "${BASH_REMATCH[1]}"
}

# Highest nightly build slot across the public feed family. kind is url or dir.
# 404 / missing file is not a floor. Any other fetch or parse failure is fatal
# so resolve-fork-release cannot mint below a shipped slot.
t3_resolve_update_feed_floor() {
  local kind="$1"
  local source="$2"
  local build_floor=""
  local manifest feed_file feed_code feed_version slot
  for manifest in latest-linux.yml latest-mac.yml latest.yml; do
    if [[ "$kind" == "dir" ]]; then
      feed_file="${source%/}/${manifest}"
      if [[ ! -f "$feed_file" ]]; then
        continue
      fi
      feed_version="$(t3_read_update_manifest_version "$feed_file")"
    else
      feed_file="$(mktemp)"
      feed_code="$(curl -sSL --max-time 30 -o "$feed_file" -w '%{http_code}' "${source%/}/${manifest}" || true)"
      if [[ "$feed_code" == "404" ]]; then
        rm -f "$feed_file"
        continue
      fi
      if [[ ! "$feed_code" =~ ^2 ]]; then
        rm -f "$feed_file"
        echo "Cannot read live update manifest ${manifest} (HTTP $feed_code); refusing to mint a version below the shipped slot." >&2
        return 1
      fi
      feed_version="$(t3_read_update_manifest_version "$feed_file")"
      rm -f "$feed_file"
    fi
    if [[ -z "$feed_version" ]]; then
      echo "Live update manifest ${manifest} has no version field; refusing to mint a version below the shipped slot." >&2
      return 1
    fi
    if ! slot="$(t3_nightly_build_slot "$feed_version")"; then
      echo "Live update manifest ${manifest} version '$feed_version' is not a nightly build id; refusing to mint a version below the shipped slot." >&2
      return 1
    fi
    if [[ -z "$build_floor" ]] || (( 10#${slot} > 10#${build_floor} )); then
      build_floor="$slot"
    fi
  done
  if [[ -n "$build_floor" ]]; then
    printf '%s\n' "$build_floor"
  fi
}

if [[ "${BASH_SOURCE[0]-}" == "${0-}" ]]; then
  case "${1-}" in
    --print-version)
      t3_read_update_manifest_version "${2:?--print-version needs a file}"
      printf '\n'
      ;;
    --dir)
      t3_resolve_update_feed_floor dir "${2:?--dir needs a directory}"
      ;;
    *)
      : "${T3CODE_DESKTOP_UPDATE_FEED_URL:?T3CODE_DESKTOP_UPDATE_FEED_URL is required}"
      t3_resolve_update_feed_floor url "$T3CODE_DESKTOP_UPDATE_FEED_URL"
      ;;
  esac
fi
