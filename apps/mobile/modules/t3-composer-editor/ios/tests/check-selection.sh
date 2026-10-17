#!/usr/bin/env bash
set -euo pipefail
module_dir=$(cd "$(dirname "$0")/.." && pwd)
source_file=${T3_COMPOSER_EDITOR_SOURCE:-"$module_dir/T3ComposerEditorView.swift"}
output=$(mktemp -d)
trap 'rm -rf "$output"' EXIT
sdk=$(xcrun --sdk macosx --show-sdk-path)
flags=(-target "$(uname -m)-apple-ios18.0-macabi" -sdk "$sdk"
       -F "$sdk/System/iOSSupport/System/Library/Frameworks")

# Run the complete UIKit editor with only Expo's view/event bridge substituted.
# No app, Simulator, React Native runtime, or clipboard access is needed.
cat > "$output/ExpoModulesCore.swift" <<'SWIFT'
import UIKit
public class AppContext {}
@MainActor open class ExpoView: UIView {
  public required init(appContext: AppContext? = nil) { super.init(frame: .zero) }
  @available(*, unavailable) public required init?(coder: NSCoder) { fatalError() }
}
public class EventDispatcher {
  public init() {}
  public func callAsFunction(_ value: [String: Any] = [:]) {}
}
SWIFT
xcrun swiftc "${flags[@]}" -emit-module -emit-library -module-name ExpoModulesCore \
  "$output/ExpoModulesCore.swift" -emit-module-path "$output/ExpoModulesCore.swiftmodule" \
  -o "$output/libExpoModulesCore.dylib"
python3 - "$module_dir/T3ComposerEditorModule.swift" "$output/Clipboard.swift" <<'PY'
import pathlib, sys
source = pathlib.Path(sys.argv[1]).read_text()
pathlib.Path(sys.argv[2]).write_text(source[:source.index("// Expo Modules 2.0")])
PY
cat > "$output/main.swift" <<'SWIFT'
import UIKit

func check(_ passed: Bool, _ message: String) {
  guard passed else {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
  }
}

func token(_ start: Int, _ end: Int, _ source: String) -> [String: Any] {
  ["type": "file", "source": source, "label": source, "start": start, "end": end]
}

@MainActor
func editor(_ value: String, _ tokens: [[String: Any]], selection: Int = 0) throws -> (T3ComposerEditorView, UITextView) {
  let view = T3ComposerEditorView()
  view.frame = CGRect(x: 0, y: 0, width: 320, height: 100)
  let tokensJson = String(data: try JSONSerialization.data(withJSONObject: tokens), encoding: .utf8)!
  let payload: [String: Any] = [
    "value": value, "tokensJson": tokensJson, "selection": ["start": selection, "end": selection],
    "mostRecentEventCount": 0, "isNativeEcho": false,
  ]
  view.setControlledDocumentJson(String(data: try JSONSerialization.data(withJSONObject: payload), encoding: .utf8)!)
  return (view, view.subviews.compactMap { $0 as? UITextView }.first!)
}

try MainActor.assumeIsolated {
  var checks = 0
  let invalidTokens = [
    token(0, 50, "invalid"), token(-10, 1, "invalid"), token(Int.min, 1, "invalid"),
    token(0, Int.max, "invalid"), token(2, 1, "invalid"), token(0, 2, "mismatch"),
  ]
  for invalid in invalidTokens {
    let (view, textView) = try editor("abc", [invalid], selection: 2)
    check(textView.text == "abc", "Invalid token changed the text")
    check(textView.selectedRange == NSRange(location: 2, length: 0), "Invalid token changed the initial selection: \(invalid)")
    for offset in 0...3 {
      view.setSelection(start: offset, end: offset)
      check(textView.selectedRange == NSRange(location: offset, length: 0), "Invalid token moved caret \(offset): \(invalid)")
      checks += 1
    }
  }

  let file = token(2, 6, "FILE")
  let skill = token(8, 13, "SKILL")
  // The duplicate and overlapping token do not render; neither may move the caret.
  let (view, textView) = try editor("aaFILEbbSKILLcc", [file, file, token(3, 6, "ILE"), skill])
  check(textView.attributedText.length == 8, "Expected two atomic chips")
  let expected = [0, 1, 2, 3, 3, 3, 3, 4, 5, 6, 6, 6, 6, 6, 7, 8]
  for (offset, displayOffset) in expected.enumerated() {
    view.setSelection(start: offset, end: offset)
    check(textView.selectedRange == NSRange(location: displayOffset, length: 0), "Wrong chip selection at \(offset): \(textView.selectedRange)")
    checks += 1
  }
  view.setSelection(start: 2, end: 13)
  check(textView.selectedRange == NSRange(location: 2, length: 4), "Selection across both chips is wrong")
  view.setSelection(start: Int.min, end: Int.max)
  check(textView.selectedRange == NSRange(location: 0, length: 8), "Selection must clamp to rendered text")

  let (unicodeView, unicodeText) = try editor("A😀e\u{301}Z", [])
  for offset in [0, 1, 3, 5, 6] {
    unicodeView.setSelection(start: offset, end: offset)
    check(unicodeText.selectedRange == NSRange(location: offset, length: 0), "UTF-16 selection changed at \(offset)")
    checks += 1
  }
  print("Passed \(checks + 2) composer selection checks with real UIKit")
}
SWIFT
xcrun swiftc "${flags[@]}" -I "$output" -L "$output" -lExpoModulesCore \
  -Xlinker -rpath -Xlinker "$output" \
  "$source_file" "$output/Clipboard.swift" "$output/main.swift" -o "$output/selection-tests"
"$output/selection-tests"
