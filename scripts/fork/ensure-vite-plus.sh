#!/usr/bin/env bash
# Source from packaging scripts. Fresh hosted Macs (macos-large) do not ship
# `vp`; the former macos-release image did. Pin VP_HOME to ~/.vite-plus — the
# directory release scripts already put on PATH — then install Vite+ when vp
# is missing. Global CLIs installed later with npm (eas-cli) also go through
# this file so Vite+'s bin-link prompt cannot hang a TTY-less CI job.
#
# Tests set T3CODE_VITE_PLUS_INSTALLER to a controlled script so this block
# can run without hitting the network.

vite_plus_home() {
  printf '%s\n' "${VP_HOME:-${HOME}/.vite-plus}"
}

vite_plus_on_path() {
  export VP_HOME
  VP_HOME="$(vite_plus_home)"
  export PATH="${VP_HOME}/bin:${PATH}"
}

vp_is_official() {
  command -v vp >/dev/null || return 1
  local out
  out="$(vp --version 2>&1 || true)"
  [[ "$out" != *"npx vp"* ]]
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
  if [[ -x "$dest" ]]; then
    return 0
  fi
  if [[ -z "$src" ]]; then
    src="$(command -v "$name" 2>/dev/null || true)"
  fi
  if [[ -z "$src" || "$src" == "$dest" ]] && command -v npm >/dev/null; then
    src="$(npm prefix -g)/bin/${name}"
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
  if command -v "$name" >/dev/null; then
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
  if ! command -v "$name" >/dev/null; then
    echo "${name} is missing after installing ${pkg}." >&2
    return 1
  fi
}
