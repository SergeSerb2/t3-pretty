#!/usr/bin/env bash
# Source from packaging scripts. Fresh hosted Macs (macos-large) do not ship
# `vp`; the former macos-release image did. Pin VP_HOME to ~/.vite-plus — the
# directory release scripts already put on PATH — then install Vite+ when vp
# is missing. Global CLIs installed later with npm (eas-cli) also go through
# this file so Vite+'s bin-link prompt cannot hang a TTY-less CI job.
#
# Windows Git Bash cannot exec the extensionless `vp` path (exit 126) even
# when `vp.exe` is next to it. windows-release already ships official Vite+
# as `C:\buildkite-agent\vite-plus\bin\vp.exe`. Prefer that `.exe` / `.cmd`,
# the same suffix NSIS uses for `buildkite-agent.exe`.
#
# Tests set T3CODE_VITE_PLUS_INSTALLER to a controlled script so this block
# can run without hitting the network.

vite_plus_home() {
  printf '%s\n' "${VP_HOME:-${HOME}/.vite-plus}"
}

vite_plus_is_windows() {
  case "$(uname -s)" in
    MINGW* | MSYS* | CYGWIN*) return 0 ;;
  esac
  return 1
}

# Git Bash reports `/c/.../bin/vp` and then fails execve without the .exe
# suffix. Copy a Windows PE that was saved extensionless, or chmod a shebang.
vite_plus_windows_repair_cli() {
  local src="$1"
  local dest="${src}.exe"
  local magic
  [[ -f "$src" ]] || return 1
  [[ -f "$dest" ]] && return 0
  magic="$(head -c 2 "$src" 2>/dev/null || true)"
  if [[ "$magic" == "MZ" ]]; then
    cp "$src" "$dest"
    return 0
  fi
  if [[ "$magic" == "#!" ]]; then
    chmod +x "$src" || return 1
    return 0
  fi
  return 1
}

vite_plus_resolve_cli() {
  local name="$1"
  local home bin candidate
  home="$(vite_plus_home)"
  bin="${home}/bin"
  if vite_plus_is_windows; then
    for candidate in "${bin}/${name}.exe" "${bin}/${name}.cmd"; do
      if [[ -f "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    done
    candidate="${bin}/${name}"
    if [[ -f "$candidate" ]] && vite_plus_windows_repair_cli "$candidate"; then
      if [[ -f "${candidate}.exe" ]]; then
        printf '%s\n' "${candidate}.exe"
        return 0
      fi
      if [[ -x "$candidate" ]]; then
        printf '%s\n' "$candidate"
        return 0
      fi
    fi
    candidate="$(command -v "${name}.exe" 2>/dev/null || true)"
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    candidate="$(command -v "${name}.cmd" 2>/dev/null || true)"
    if [[ -n "$candidate" && -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
    return 1
  fi
  candidate="$(command -v "$name" 2>/dev/null || true)"
  if [[ -n "$candidate" && -x "$candidate" ]]; then
    printf '%s\n' "$candidate"
    return 0
  fi
  return 1
}

vite_plus_windows_path() {
  local path="$1"
  if command -v cygpath >/dev/null 2>&1; then
    cygpath -w "$path"
    return
  fi
  printf '%s\n' "$path"
}

vite_plus_exec_cli() {
  local name="$1"
  shift
  local cmd
  cmd="$(vite_plus_resolve_cli "$name")" || {
    echo "${name} is not installed" >&2
    return 127
  }
  case "$cmd" in
    *.cmd | *.bat)
      if command -v cmd.exe >/dev/null 2>&1; then
        cmd.exe //c "$(vite_plus_windows_path "$cmd")" "$@"
        return
      fi
      ;;
  esac
  "$cmd" "$@"
}

vite_plus_bind_windows_cli() {
  local name="$1"
  vite_plus_is_windows || return 0
  case "$name" in
    vp) vp() { vite_plus_exec_cli vp "$@"; } ;;
    eas) eas() { vite_plus_exec_cli eas "$@"; } ;;
    *)
      eval "${name}() { vite_plus_exec_cli $(printf '%q' "$name") \"\$@\"; }"
      ;;
  esac
}

vite_plus_cli_available() {
  local name="$1"
  if vite_plus_is_windows; then
    vite_plus_resolve_cli "$name" >/dev/null
    return
  fi
  command -v "$name" >/dev/null
}

vite_plus_on_path() {
  export VP_HOME
  VP_HOME="$(vite_plus_home)"
  export PATH="${VP_HOME}/bin:${PATH}"
  vite_plus_bind_windows_cli vp
}

vp_is_official() {
  local out
  if vite_plus_is_windows; then
    vite_plus_resolve_cli vp >/dev/null || return 1
  elif ! command -v vp >/dev/null; then
    return 1
  fi
  # A failed exec (Git Bash 126) used to look official: empty output is not
  # the npm `npx vp` stub. Require a real version string.
  out="$(vp --version 2>&1)" || return 1
  [[ -n "$out" && "$out" != *"npx vp"* ]]
}

install_vite_plus() {
  export CI="${CI:-true}"
  export VP_HOME
  VP_HOME="$(vite_plus_home)"
  if [[ -n "${T3CODE_VITE_PLUS_INSTALLER:-}" ]]; then
    bash "${T3CODE_VITE_PLUS_INSTALLER}"
    return
  fi
  curl -fsSL https://vite.plus | bash
}

ensure_vite_plus() {
  local purpose="${1:-to run this job}"
  vite_plus_on_path
  if vp_is_official; then
    return 0
  fi
  echo "vp is missing; installing Vite+ into ${VP_HOME}"
  if ! install_vite_plus; then
    echo "Vite+ install failed; vp is required ${purpose}." >&2
    return 1
  fi
  vite_plus_on_path
  if ! vp_is_official; then
    echo "vp is required ${purpose}." >&2
    return 1
  fi
}

# After `npm install -g`, Vite+ may ask to symlink the new CLI into VP_HOME/bin.
# That [Y/n] prompt still appears under CI=true and hangs a TTY-less Buildkite
# job (hosted M4 iOS OTA, build 1883). Treat CI, Buildkite, or a non-TTY stdin
# as auto-link.
vite_plus_noninteractive() {
  [[ -n "${CI:-}" || -n "${BUILDKITE:-}" || ! -t 0 ]]
}

vite_plus_npm_global_bin() {
  command -v npm >/dev/null || return 1
  printf '%s\n' "$(npm prefix -g)/bin"
}

# Put `name` on PATH via VP_HOME/bin without prompting. Source is an explicit
# path, `command -v`, or npm's global bin.
vite_plus_link_bin() {
  local name="$1"
  local src="${2:-}"
  local bin dest
  bin="$(vite_plus_home)/bin"
  dest="${bin}/${name}"
  if [[ -x "$dest" || -f "${dest}.exe" || -f "${dest}.cmd" ]]; then
    return 0
  fi
  if [[ -z "$src" ]]; then
    src="$(command -v "$name" 2>/dev/null || true)"
  fi
  if [[ -z "$src" || "$src" == "$dest" ]] && command -v npm >/dev/null; then
    src="$(npm prefix -g)/bin/${name}"
    if [[ ! -e "$src" && -e "$(npm prefix -g)/bin/${name}.cmd" ]]; then
      src="$(npm prefix -g)/bin/${name}.cmd"
    fi
  fi
  if [[ ! -e "$src" || "$src" == "$dest" ]]; then
    echo "Could not find ${name} to link into ${bin}." >&2
    return 1
  fi
  mkdir -p "$bin"
  ln -sfn "$src" "$dest"
}

# Install a global npm CLI and make it visible on PATH. On CI / non-TTY, answer
# Vite+'s bin-link prompt and create the link ourselves if the shim never does.
vite_plus_install_global_cli() {
  local pkg="$1"
  local name="${2:-$1}"
  local npm_bin
  vite_plus_on_path
  if npm_bin="$(vite_plus_npm_global_bin)"; then
    export PATH="${npm_bin}:${PATH}"
  fi
  if vite_plus_cli_available "$name"; then
    vite_plus_bind_windows_cli "$name"
    return 0
  fi
  if ! command -v npm >/dev/null; then
    echo "npm is required to install ${pkg}." >&2
    return 1
  fi
  if vite_plus_noninteractive; then
    export CI="${CI:-true}"
    # Several Y answers cover extra bins from one package. Avoid `yes` under
    # pipefail: yes dies with SIGPIPE when npm closes stdin.
    printf 'y\ny\ny\ny\ny\n' | npm install -g "$pkg"
    vite_plus_link_bin "$name"
  else
    npm install -g "$pkg"
  fi
  if npm_bin="$(vite_plus_npm_global_bin)"; then
    export PATH="${npm_bin}:${PATH}"
  fi
  vite_plus_on_path
  if ! vite_plus_cli_available "$name"; then
    echo "${name} is missing after installing ${pkg}." >&2
    return 1
  fi
  vite_plus_bind_windows_cli "$name"
}
