#!/usr/bin/env bash
set -euo pipefail
module_dir=$(cd "$(dirname "$0")/.." && pwd)
source_file=${T3_LAYOUT_METRICS_SOURCE:-"$module_dir/T3LayoutMetricsView.swift"}
output=$(mktemp -d)
trap 'rm -rf "$output"' EXIT

# Keep Expo outside this SDK regression: UIKit and the production view must compile
# against both installed iOS SDKs, without CocoaPods or a running Simulator.
cat > "$output/ExpoModulesCore.swift" <<'SWIFT'
import UIKit
public class AppContext {}
@MainActor open class ExpoView: UIView {
  public required init(appContext: AppContext? = nil) { super.init(frame: .zero) }
  @available(*, unavailable) public required init?(coder: NSCoder) { fatalError() }
}
public class EventDispatcher {
  public init() {}
  public func callAsFunction(_ value: [String: Any]) {}
}
open class ExpoAppDelegateSubscriber: NSObject {}
SWIFT

for platform in iphoneos iphonesimulator; do
  sdk=$(xcrun --sdk "$platform" --show-sdk-path)
  target=arm64-apple-ios18.0
  if [[ "$platform" == iphonesimulator ]]; then
    target="$(uname -m)-apple-ios18.0-simulator"
  fi
  mkdir -p "$output/$platform"
  xcrun swiftc -emit-module -module-name ExpoModulesCore -target "$target" -sdk "$sdk" \
    "$output/ExpoModulesCore.swift" \
    -emit-module-path "$output/$platform/ExpoModulesCore.swiftmodule"
  xcrun swiftc -emit-module -module-name T3LayoutMetrics -target "$target" -sdk "$sdk" \
    -I "$output/$platform" "$source_file" "$module_dir/T3WorkspaceOrientationSubscriber.swift" \
    -emit-module-path "$output/$platform/T3LayoutMetrics.swiftmodule"
  echo "Layout metrics compile passed: $platform $(xcrun --sdk "$platform" --show-sdk-version)"
done
