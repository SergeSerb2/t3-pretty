#!/usr/bin/env bash
# Hosted linux-small Node for imported fork-release jobs. Do not unpack into
# /usr/local: those runners are unprivileged.
set -euo pipefail

if command -v node >/dev/null; then
  node --version
  exit 0
fi

prefix="${HOME}/.local/t3-pretty-node24"
echo "Runner Node is missing; installing Node 24 for linux-x64 into ${prefix}."
tmp="$(mktemp -d)"
cleanup() {
  rm -rf "$tmp"
}
trap cleanup EXIT

base="https://nodejs.org/download/release/latest-v24.x"
line="$(curl -fsSL --retry 3 "${base}/SHASUMS256.txt" \
  | grep -E 'node-v24\.[0-9.]+-linux-x64\.tar\.gz$' | head -n1)"
test -n "$line"
sha="${line%% *}"
name="${line##* }"
curl -fsSL --retry 3 -o "${tmp}/${name}" "${base}/${name}"
( cd "$tmp" && printf '%s  %s\n' "$sha" "$name" | sha256sum -c - )
rm -rf "$prefix"
mkdir -p "$prefix"
tar -xzf "${tmp}/${name}" -C "$prefix" --strip-components=1
export PATH="${prefix}/bin:${PATH}"
if [[ -n "${GITHUB_PATH:-}" ]]; then
  echo "${prefix}/bin" >> "$GITHUB_PATH"
fi
command -v node >/dev/null
node --version
