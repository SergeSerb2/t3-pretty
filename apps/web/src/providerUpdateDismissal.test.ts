import { beforeEach, describe, expect, it } from "vite-plus/test";

import { removeLocalStorageItem } from "./hooks/useLocalStorage";
import {
  dismissProviderUpdateNotification,
  isProviderUpdateNotificationDismissed,
  PROVIDER_UPDATE_DISMISSALS_STORAGE_KEY,
} from "./providerUpdateDismissal";

describe("providerUpdateDismissal", () => {
  beforeEach(() => {
    removeLocalStorageItem(PROVIDER_UPDATE_DISMISSALS_STORAGE_KEY);
  });

  it("persists provider update dismissals by notification key", () => {
    expect(isProviderUpdateNotificationDismissed("kimi:1.14.33")).toBe(false);

    dismissProviderUpdateNotification("kimi:1.14.33");

    expect(isProviderUpdateNotificationDismissed("kimi:1.14.33")).toBe(true);
    expect(isProviderUpdateNotificationDismissed("kimi:1.14.34")).toBe(false);
  });
});
