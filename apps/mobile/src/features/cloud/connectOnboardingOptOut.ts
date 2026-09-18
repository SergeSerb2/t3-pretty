import { loadPreferences, updatePreferences } from "../../persistence/imperative";
import {
  CONNECT_ONBOARDING_ACCOUNT_ID_MAX_LENGTH,
  CONNECT_ONBOARDING_OPT_OUT_MAX_ACCOUNTS,
} from "../../persistence/mobile-preferences";

// Lives apart from connectOnboarding.ts so CloudAuthProvider (which imports
// the request signal) never pulls the persistence adapter into its
// module graph; that breaks CloudAuthProvider.test.ts suite loading.

/** Whether the account chose "Don't show this again". */
export async function isConnectOnboardingOptedOut(accountId: string): Promise<boolean> {
  const preferences = await loadPreferences();
  return preferences.connectOnboardingOptOutAccounts?.includes(accountId) ?? false;
}

/** Persists "Don't show this again" for the account. */
export async function optOutOfConnectOnboarding(accountId: string): Promise<void> {
  if (accountId.length === 0 || accountId.length > CONNECT_ONBOARDING_ACCOUNT_ID_MAX_LENGTH) {
    throw new Error("Cannot persist an invalid Connect onboarding account id.");
  }
  await updatePreferences((current) => {
    const optedOut = current.connectOnboardingOptOutAccounts ?? [];
    if (
      optedOut.at(-1) === accountId &&
      optedOut.length <= CONNECT_ONBOARDING_OPT_OUT_MAX_ACCOUNTS
    ) {
      return {};
    }
    const retained = optedOut
      .filter((existingAccount) => existingAccount !== accountId)
      .slice(-(CONNECT_ONBOARDING_OPT_OUT_MAX_ACCOUNTS - 1));
    return { connectOnboardingOptOutAccounts: [...retained, accountId] };
  });
}
