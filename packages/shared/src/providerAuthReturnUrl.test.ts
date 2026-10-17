import { describe, expect, it } from "vite-plus/test";
import { providerAuthNavigationUrl, providerAuthReturnUrl } from "./providerAuthReturnUrl.ts";

describe("provider auth return destinations", () => {
  it.each(["t3code", "t3code-dev"])(
    "returns to %s Welcome and the selected settings instance",
    (scheme) => {
      expect(providerAuthReturnUrl(`${scheme}://app/welcome?code=secret#agents:machine-id`)).toBe(
        `${scheme}://app/welcome#agents:machine-id`,
      );
      expect(
        providerAuthReturnUrl(`${scheme}://app/settings/providers?instanceId=work&code=secret`),
      ).toBe(`${scheme}://app/settings/providers?instanceId=work`);
    },
  );
  it.each(["t3code", "t3code-dev"])("canonicalizes %s hash routes before sanitizing", (scheme) => {
    expect(providerAuthReturnUrl(`${scheme}://app/#/welcome?code=secret#agents:machine-id`)).toBe(
      `${scheme}://app/welcome#agents:machine-id`,
    );
    expect(
      providerAuthReturnUrl(
        `${scheme}://app/?code=outer#/settings/providers?instanceId=work&environmentId=remote&code=secret`,
      ),
    ).toBe(`${scheme}://app/settings/providers?instanceId=work&environmentId=remote`);
  });
  it.each([
    ["t3code://app/welcome#agents:machine", "t3code://app/#/welcome#agents:machine"],
    [
      "t3code-dev://app/settings/providers?instanceId=work&code=secret",
      "t3code-dev://app/#/settings/providers?instanceId=work",
    ],
    [
      "https://app.t3.codes/welcome?code=secret#agents:machine",
      "https://app.t3.codes/welcome#agents:machine",
    ],
    [
      "http://localhost:3773/settings/providers?instanceId=work",
      "http://localhost:3773/settings/providers?instanceId=work",
    ],
  ])("navigates to the correct router for %s", (input, expected) => {
    expect(providerAuthNavigationUrl(input)).toBe(expected);
    expect(providerAuthNavigationUrl(expected)).toBe(expected);
  });
  it.each([
    "t3code://attacker/welcome",
    "t3code://app:123/welcome",
    "t3code://app/auth/callback",
    "t3code://user@ app/welcome",
    "t3code://app/welcome/../evil",
    "https://attacker.example/welcome",
    "file:///welcome",
    "javascript:alert(1)",
    "t3code://app/#//attacker.example/welcome",
    "t3code://user:password@app/#/welcome",
    "t3code://app/other#/welcome",
    "t3code://app/#/auth/callback?code=secret",
    "t3code://app/#/settings/../evil",
    "https://attacker.example/#/welcome",
    "https://app.t3.codes/#/welcome",
  ])("rejects %s", (url) => {
    expect(providerAuthReturnUrl(url)).toBeUndefined();
    expect(providerAuthNavigationUrl(url)).toBeUndefined();
  });
});
