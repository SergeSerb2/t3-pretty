#!/bin/bash
set -euo pipefail
module_dir=$(cd "$(dirname "$0")/.." && pwd)
sdk=$(xcrun --sdk macosx --show-sdk-path)
output=$(mktemp -d)
trap 'rm -rf "$output"' EXIT
python3 - "$module_dir" "$output" <<'PY'
import pathlib, sys
module_dir, output = map(pathlib.Path, sys.argv[1:])
source = (module_dir / "ios/T3MarkdownText.mm").read_text()
start = source.index("- (void)drawRect:(CGRect)rect")
end = source.index("\n- (void)loadAttachmentImages:", start)
(output / "T3MarkdownTextDraw.inc").write_text(source[start:end])
PY
xcrun clang++ -std=c++17 -fobjc-arc -fblocks -O2 \
  -target "$(uname -m)-apple-ios17.0-macabi" -isysroot "$sdk" \
  -iframework "$sdk/System/iOSSupport/System/Library/Frameworks" \
  -L "$sdk/System/iOSSupport/usr/lib" -framework UIKit -framework Foundation -framework CoreGraphics \
  -I "$output" "$module_dir/tests/ios/T3MarkdownTextDrawTests.mm" \
  -o "$output/draw-tests"
"$output/draw-tests"
