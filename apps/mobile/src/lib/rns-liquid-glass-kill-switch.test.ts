import * as NodeFs from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { describe, expect, it } from "vite-plus/test";

const patchPath = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../../../patches/react-native-screens@4.26.2.patch",
);

describe("RNS liquid-glass kill-switch", () => {
  it("keeps item-group apply behind the same hard-off helper as UIGlassEffect", () => {
    const patch = NodeFs.readFileSync(patchPath, "utf8");
    expect(patch).toContain("static BOOL RNSAllowsPatchedLiquidGlassChrome(void)");
    expect(patch).toContain("if (@available(iOS 16.0, *) && RNSAllowsPatchedLiquidGlassChrome())");
    expect(patch).toContain("navitem.leadingItemGroups");
    expect(patch).toContain("navitem.trailingItemGroups");
    expect(patch).toContain("navitem.centerItemGroups");
    expect(patch).toContain("if (@available(iOS 26.0, *) && RNSAllowsPatchedLiquidGlassChrome())");
    expect(patch).toContain('NSNumber *sharesBackground = dict[@"sharesBackground"]');
  });
});
