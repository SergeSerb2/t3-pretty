import * as Schema from "effect/Schema";

/**
 * Accounts that opted out of the post-sign-in Surge Connect onboarding wizard
 * ("Don't show this again"). The wizard otherwise shows on every sign-in,
 * since sign-out clears the connected environments.
 */
export const CONNECT_ONBOARDING_OPT_OUT_STORAGE_KEY = "t3code:connect-onboarding-opt-out:v1";
export const CONNECT_ONBOARDING_OPT_OUT_MAX_ACCOUNTS = 64;
export const CONNECT_ONBOARDING_ACCOUNT_ID_MAX_LENGTH = 512;

export const ConnectOnboardingOptOutSchema = Schema.Struct({
  optOutAccounts: Schema.Array(
    Schema.String.check(Schema.isMaxLength(CONNECT_ONBOARDING_ACCOUNT_ID_MAX_LENGTH)),
  ).check(Schema.isMaxLength(CONNECT_ONBOARDING_OPT_OUT_MAX_ACCOUNTS)),
});

export type ConnectOnboardingOptOutState = typeof ConnectOnboardingOptOutSchema.Type;

export const EMPTY_CONNECT_ONBOARDING_OPT_OUT_STATE: ConnectOnboardingOptOutState = {
  optOutAccounts: [],
};

export function rememberConnectOnboardingOptOut(
  state: ConnectOnboardingOptOutState,
  account: string,
): ConnectOnboardingOptOutState {
  const existingIndex = state.optOutAccounts.indexOf(account);
  if (
    existingIndex === state.optOutAccounts.length - 1 &&
    state.optOutAccounts.length <= CONNECT_ONBOARDING_OPT_OUT_MAX_ACCOUNTS
  ) {
    return state;
  }

  const retained = state.optOutAccounts
    .filter((existingAccount) => existingAccount !== account)
    .slice(-(CONNECT_ONBOARDING_OPT_OUT_MAX_ACCOUNTS - 1));
  return { optOutAccounts: [...retained, account] };
}
