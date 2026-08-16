import { describe, expect, it } from "vite-plus/test";

import { playwrightInjectedRuntimeInstallExpression } from "./PlaywrightInjectedRuntime.ts";
import { playwrightInjectedSource } from "./PlaywrightInjectedSource.generated.ts";

describe("playwright injected runtime", () => {
  it("carries the runtime lifted from playwright-core at build time", () => {
    expect(playwrightInjectedSource.length).toBeGreaterThan(100_000);
    expect(playwrightInjectedSource).toContain("InjectedScript");
  });

  it("builds an idempotent install expression", () => {
    expect(playwrightInjectedRuntimeInstallExpression).toContain("__t3PlaywrightInjected");
    expect(playwrightInjectedRuntimeInstallExpression).toContain(
      '"testIdAttributeName":"data-testid"',
    );
  });
});
