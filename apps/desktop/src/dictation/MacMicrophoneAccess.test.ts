import { describe, expect, it } from "@effect/vitest";

import { ensureMacMicrophoneAccess } from "./MacMicrophoneAccess.ts";

describe("macOS microphone access", () => {
  it("asks when the user has not been prompted", async () => {
    let asked = false;
    const result = await ensureMacMicrophoneAccess({
      getStatus: () => "not-determined",
      ask: async () => {
        asked = true;
        return true;
      },
    });
    expect(asked).toBe(true);
    expect(result).toBe("granted");
  });

  it("asks when the current status is unknown", async () => {
    const result = await ensureMacMicrophoneAccess({
      getStatus: () => "unknown",
      ask: async () => false,
    });
    expect(result).toBe("denied");
  });

  it("keeps an existing grant without asking again", async () => {
    let asked = false;
    const result = await ensureMacMicrophoneAccess({
      getStatus: () => "granted",
      ask: async () => {
        asked = true;
        return false;
      },
    });
    expect(asked).toBe(false);
    expect(result).toBe("granted");
  });

  it("does not ask again after the user has denied access", async () => {
    let asked = false;
    const result = await ensureMacMicrophoneAccess({
      getStatus: () => "denied",
      ask: async () => {
        asked = true;
        return true;
      },
    });
    expect(asked).toBe(false);
    expect(result).toBe("denied");
  });

  it("does not ask when microphone access is restricted", async () => {
    let asked = false;
    const result = await ensureMacMicrophoneAccess({
      getStatus: () => "restricted",
      ask: async () => {
        asked = true;
        return true;
      },
    });
    expect(asked).toBe(false);
    expect(result).toBe("restricted");
  });
});
