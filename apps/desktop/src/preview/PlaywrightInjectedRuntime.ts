/**
 * The expression that installs Playwright's injected script into a guest page
 * (selector engines, ARIA queries, action preconditions). The script itself is
 * lifted out of playwright-core at build time by
 * scripts/build-playwright-injected.mjs, so nothing resolves, reads, or
 * evaluates the 10 MB package at runtime.
 */
import { playwrightInjectedSource } from "./PlaywrightInjectedSource.generated.ts";

const PLAYWRIGHT_INJECTED_OPTIONS = JSON.stringify({
  isUnderTest: false,
  sdkLanguage: "javascript",
  testIdAttributeName: "data-testid",
  stableRafCount: 1,
  browserName: "chromium",
  shouldPrependErrorPrefix: false,
  isUtilityWorld: false,
  customEngines: [],
});

export const playwrightInjectedRuntimeInstallExpression = `(() => {
    if (globalThis.__t3PlaywrightInjected) return true;
    const module = { exports: {} };
    ${playwrightInjectedSource}
    globalThis.__t3PlaywrightInjected = new (module.exports.InjectedScript())(globalThis, ${PLAYWRIGHT_INJECTED_OPTIONS});
    return true;
  })()`;
