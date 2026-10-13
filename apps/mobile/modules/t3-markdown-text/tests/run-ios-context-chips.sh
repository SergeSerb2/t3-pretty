#!/usr/bin/env bash
set -euo pipefail
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
module_dir=${T3_MARKDOWN_CHIP_SOURCE_ROOT:-"$script_dir/.."}
scratch_dir=$(mktemp -d "${TMPDIR:-/tmp}/t3-markdown-chips.XXXXXX")
trap 'rm -rf -- "$scratch_dir"' EXIT
python3 - "$module_dir" "$scratch_dir" <<'PY'
import pathlib
import sys
module, output = map(pathlib.Path, sys.argv[1:])
header = (module / "ios/T3MarkdownTextShadowNode.h").read_text()
start = header.index("struct T3MarkdownTextAttachmentRange")
end = header.index("class T3MarkdownTextStateReal", start)
(output / "ProductionAttachmentTypes.inc").write_text(header[start:end])
for filename, signature, target in (
    ("T3MarkdownText.mm", "static void T3MarkdownTextApplyAttachments(", "ProductionDrawAttachments.inc"),
    ("T3MarkdownTextShadowNode.mm", "static void applyAttachments(", "ProductionShadowAttachments.inc"),
    ("T3MarkdownText.mm", "- (void)copy:(id)sender\n", "ProductionCopyMethod.inc"),
):
    source = (module / "ios" / filename).read_text()
    start = source.index(signature)
    end = source.index("\n}\n", start) + 3
    (output / target).write_text(source[start:end])
source = (module / "ios/T3MarkdownText.mm").read_text()
start = source.index("    NSMutableString *accessibleText =")
end = source.index("    if (savedRange.length", start)
(output / "ProductionAccessibilityLabel.inc").write_text(source[start:end])
implementation = module / "ios/T3ContextChipAttachment.mm"
(output / "ProductionChipImplementation.inc").write_text(
    implementation.read_text() if implementation.exists() else '#import "T3ContextChip.h"\n'
)
(output / "ProductionChipFeatures.inc").write_text(
    "#define T3_LAZY_CONTEXT_CHIPS " + str(int(implementation.exists())) + "\n"
)
PY
sdk=$(xcrun --sdk macosx --show-sdk-path)
flags=(-std=c++20 -fobjc-arc -fblocks -O2 -Wall -Wextra -Werror
       -Wno-unused-parameter -Wno-unused-function
       -target "$(uname -m)-apple-ios17.0-macabi" -isysroot "$sdk"
       -iframework "$sdk/System/iOSSupport/System/Library/Frameworks"
       -L "$sdk/System/iOSSupport/usr/lib")
if [[ -n "${T3_MARKDOWN_TEST_SANITIZER:-}" ]]; then
  flags+=("-fsanitize=$T3_MARKDOWN_TEST_SANITIZER" -fno-omit-frame-pointer -g)
fi
xcrun clang++ "${flags[@]}" -I "$scratch_dir" -I "$module_dir/ios" \
  -framework UIKit -framework Foundation -framework CoreGraphics \
  "$script_dir/ios/T3ContextChipTests.mm" -o "$scratch_dir/chip-tests"
"$scratch_dir/chip-tests"
