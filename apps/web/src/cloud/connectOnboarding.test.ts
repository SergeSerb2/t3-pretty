import { describe, expect, it } from "vite-plus/test";

import {
  CONNECT_ONBOARDING_OPT_OUT_MAX_ACCOUNTS,
  rememberConnectOnboardingOptOut,
} from "./connectOnboarding";

describe("rememberConnectOnboardingOptOut", () => {
  it("keeps the most recent account opt-outs within the persisted ceiling", () => {
    const optOutAccounts = Array.from(
      { length: CONNECT_ONBOARDING_OPT_OUT_MAX_ACCOUNTS },
      (_, index) => `account-${index}`,
    );

    const next = rememberConnectOnboardingOptOut({ optOutAccounts }, "account-new");

    expect(next.optOutAccounts).toHaveLength(CONNECT_ONBOARDING_OPT_OUT_MAX_ACCOUNTS);
    expect(next.optOutAccounts[0]).toBe("account-1");
    expect(next.optOutAccounts.at(-1)).toBe("account-new");
  });

  it("moves an existing account to the recent end without duplicating it", () => {
    const next = rememberConnectOnboardingOptOut(
      { optOutAccounts: ["account-a", "account-b", "account-c"] },
      "account-b",
    );

    expect(next.optOutAccounts).toEqual(["account-a", "account-c", "account-b"]);
  });
});
