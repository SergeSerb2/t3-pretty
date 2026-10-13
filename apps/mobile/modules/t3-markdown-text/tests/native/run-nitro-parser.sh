#!/usr/bin/env bash
set -euo pipefail

fixture_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
module_root="$(cd -- "$fixture_root/../.." && pwd)"
source_root="${T3_NITRO_SOURCE_ROOT:-$module_root/../../node_modules/react-native-nitro-markdown}"
build_root="$(mktemp -d "${TMPDIR:-/tmp}/t3-nitro-parser.XXXXXX")"
trap 'rm -rf "$build_root"' EXIT

flags=(-Wall -Wextra -Werror)
if [[ -n "${T3_NITRO_SANITIZER:-}" ]]; then
  flags+=(-fsanitize="$T3_NITRO_SANITIZER" -g)
fi
xcrun clang "${flags[@]}" -Dmd_parse=t3_real_md_parse -c "$source_root/cpp/md4c/md4c.c" -o "$build_root/md4c.o"
xcrun clang++ "${flags[@]}" -std=c++20 \
  -I "$source_root/cpp/core" -I "$source_root/cpp/md4c" \
  "$fixture_root/NitroParserRetentionTests.cpp" "$source_root/cpp/core/MD4CParser.cpp" \
  "$build_root/md4c.o" -o "$build_root/tests"
"$build_root/tests"
