#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source_file=${T3_MARKDOWN_RECYCLE_SOURCE:-"$script_dir/../ios/T3MarkdownText.mm"}
scratch_dir=$(mktemp -d "${TMPDIR:-/tmp}/t3-markdown-recycle.XXXXXX")
trap 'rm -rf -- "$scratch_dir"' EXIT
python3 - "$source_file" "$scratch_dir/ProductionLifecycleMethods.inc" <<'PY'
import pathlib
import sys
source = pathlib.Path(sys.argv[1]).read_text()
methods = []
for signature in ("- (void)prepareForRecycle\n", "- (void)updateProps:"):
    start = source.index(signature)
    end = source.index("\n}\n", start) + 3
    methods.append(source[start:end])
output = pathlib.Path(sys.argv[2])
output.write_text("\n\n".join(methods))
start = source.index("- (void)copy:(id)sender\n")
end = source.index("\n}\n", start) + 3
output.with_name("ProductionCopyMethod.inc").write_text(source[start:end])
PY
sdk=$(xcrun --sdk macosx --show-sdk-path)
flags=(-std=c++20 -fobjc-arc -fblocks -Wall -Wextra -Werror -Wno-unused-parameter
       -target "$(uname -m)-apple-ios17.0-macabi" -isysroot "$sdk"
       -iframework "$sdk/System/iOSSupport/System/Library/Frameworks"
       -L "$sdk/System/iOSSupport/usr/lib")
if [[ -n "${T3_MARKDOWN_TEST_SANITIZER:-}" ]]; then
  flags+=("-fsanitize=$T3_MARKDOWN_TEST_SANITIZER" -fno-omit-frame-pointer -g)
fi
xcrun clang++ "${flags[@]}" -I "$scratch_dir" -framework UIKit -framework Foundation -framework CoreGraphics \
  "$script_dir/ios/T3MarkdownTextRecycleTests.mm" -o "$scratch_dir/recycle-tests"
"$scratch_dir/recycle-tests"
