import { describe, expect, it } from "@effect/vitest";

import { parseOriginAuthStatus } from "./originAuthStatus.ts";

describe("parseOriginAuthStatus", () => {
  it("reads a signed-in origin CLI status", () => {
    expect(
      parseOriginAuthStatus(
        [
          "Account:     serge.serbinenko@gmail.com",
          "Auth method: api-key",
          "Endpoint:    https://api2.cursor.sh",
          "Token:       valid",
          "API key:     crsr_488...",
        ].join("\n"),
      ),
    ).toEqual({
      account: "serge.serbinenko@gmail.com",
      tokenValid: true,
      endpoint: "https://api2.cursor.sh",
    });
  });

  it("treats a missing or invalid token as unsigned-in", () => {
    expect(parseOriginAuthStatus("Account: someone\nToken: invalid")).toEqual({
      account: "someone",
      tokenValid: false,
      endpoint: null,
    });
    expect(parseOriginAuthStatus("not signed in")).toEqual({
      account: null,
      tokenValid: false,
      endpoint: null,
    });
  });
});
