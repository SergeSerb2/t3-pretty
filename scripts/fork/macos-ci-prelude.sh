#!/usr/bin/env bash
# Source at the start of macos-release GHA-importer steps.
# The importer often omits GITHUB_PATH / GITHUB_ENV, so PATH and secrets
# persist through this file instead.
_t3_here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=ci-env.sh
. "${_t3_here}/ci-env.sh"
unset _t3_here
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:${HOME}/.vite-plus/bin:${HOME}/.local/bin:${PATH}"
_t3_ci_env="$(t3_ci_env_path)"
if [[ -f "$_t3_ci_env" ]]; then
  # shellcheck disable=SC1090
  . "$_t3_ci_env"
fi

# Persist a scalar for this step and later prelude-sourced steps. Writes
# GITHUB_ENV only when the importer set that file.
t3_persist_env() {
  local name="$1"
  local value="$2"
  mkdir -p "$(dirname "$_t3_ci_env")"
  if [[ -f "$_t3_ci_env" ]]; then
    grep -v "^export ${name}=" "$_t3_ci_env" > "${_t3_ci_env}.tmp" || true
    mv "${_t3_ci_env}.tmp" "$_t3_ci_env"
  fi
  printf 'export %s=%q\n' "$name" "$value" >> "$_t3_ci_env"
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    {
      printf '%s<<__T3_CI_ENV_EOF__\n' "$name"
      printf '%s\n' "$value"
      printf '__T3_CI_ENV_EOF__\n'
    } >> "$GITHUB_ENV"
  fi
  printf -v "$name" '%s' "$value"
  export "$name"
}

# Persist KEY=value lines from an eas env:pull dotenv file. Strips an optional
# `export ` prefix, trims around `=`, and removes one matching quote pair.
t3_persist_dotenv_file() {
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
    t3_persist_env "$name" "$value"
  done < "$file"
}

t3_require_ota() {
  local gate="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/t3-ota-present"
  if [[ -f "$gate" ]] && [[ "$(cat "$gate")" == "false" ]]; then
    echo "Skipping OTA step: Expo token was not loaded"
    exit 0
  fi
}
