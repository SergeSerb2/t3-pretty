import { EnvironmentId, ProviderInstanceId } from "@t3tools/contracts";
import { codexAuthDeliveryUrl } from "@t3tools/shared/codexAuthHandoff";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  clearProviderAuthDelivery,
  pendingProviderAuthDelivery,
  prepareProviderAuthDelivery,
} from "./providerAuthDelivery";

afterEach(() => {
  clearProviderAuthDelivery();
  vi.unstubAllGlobals();
});

it.each([
  ["t3code://app/welcome#agents:machine", "t3code://app/#/welcome#agents:machine"],
  [
    "t3code-dev://app/settings/providers?instanceId=work",
    "t3code-dev://app/#/settings/providers?instanceId=work",
  ],
  ["https://app.t3.codes/welcome#agents:machine", "https://app.t3.codes/welcome#agents:machine"],
])(
  "removes the provider code and restores the correct router URL for %s",
  (returnUrl, expected) => {
    const state = "a".repeat(43);
    const auth = new URL("https://auth.openai.com/api/accounts/authorize");
    auth.search = new URLSearchParams({
      client_id: "dynamic_agent_client",
      response_type: "code",
      redirect_uri: "http://127.0.0.1:34338/auth/callback",
      state,
      code_challenge_method: "S256",
      code_challenge: "b".repeat(43),
    }).toString();
    const href = codexAuthDeliveryUrl(
      {
        authorizationUrl: auth.toString(),
        returnUrl,
        environmentId: EnvironmentId.make("machine"),
        instanceId: ProviderInstanceId.make("work"),
        flowId: "flow",
      },
      `http://127.0.0.1:34338/auth/callback?code=private-code&state=${state}`,
    );
    const replaceState = vi.fn();
    vi.stubGlobal("window", { location: new URL(href), history: { state: {}, replaceState } });

    prepareProviderAuthDelivery();

    expect(replaceState).toHaveBeenCalledWith({}, "", expected);
    expect(String(replaceState.mock.calls[0]?.[2])).not.toContain("private-code");
    expect(pendingProviderAuthDelivery()?.flowId).toBe("flow");
  },
);
