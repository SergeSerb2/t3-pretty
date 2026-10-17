import type { DesktopBridge } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const open = vi.fn();
const setItem = vi.fn();

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", `pk_live_${btoa("clerk.t3.codes$")}`);
  vi.stubEnv("VITE_CLERK_JWT_TEMPLATE", "t3-relay");
  vi.stubEnv("VITE_T3CODE_RELAY_URL", "https://relay.t3.codes");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function browser(href: string) {
  vi.stubGlobal("window", {
    location: new URL(href),
    open,
    localStorage: { getItem: () => null, setItem },
  });
}

describe("public browser Clerk handoff", () => {
  it.each([
    "http://localhost:7370/",
    "https://sergeserb2.github.io/t3-pretty/welcome",
    "https://app.t3.codes.attacker.test/",
    "http://app.t3.codes/",
    "https://app.t3.codes:7370/",
  ])(
    "keeps Clerk closed at %s and opens the official app when sign-in is requested",
    async (href) => {
      browser(href);
      const gate = await import("./clerkGate");
      expect(gate.isClerkGateOpen()).toBe(false);
      gate.openClerkGate({ promptSignIn: true });
      expect(open).toHaveBeenCalledExactlyOnceWith(
        "https://app.t3.codes/settings/connections",
        "_blank",
        "noopener,noreferrer",
      );
      expect(gate.isClerkGateOpen()).toBe(false);
      expect(gate.consumeClerkSignInRequest()).toBe(false);
      expect(setItem).not.toHaveBeenCalled();
    },
  );

  it("preserves the CLI authorization request when handing off a Pages connect link", async () => {
    browser(
      "https://sergeserb2.github.io/t3-pretty/connect#state=request-1&challenge=proof-1&port=34338",
    );
    const gate = await import("./clerkGate");
    gate.openClerkGate({ promptSignIn: true });
    expect(open).toHaveBeenCalledWith(
      "https://app.t3.codes/connect#state=request-1&challenge=proof-1&port=34338",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it.each(["https://app.t3.codes/welcome", "https://nightly.app.t3.codes/"])(
    "keeps %s on the supported browser SDK",
    async (href) => {
      browser(href);
      const gate = await import("./clerkGate");
      expect(gate.isClerkGateOpen()).toBe(true);
      gate.openClerkGate({ promptSignIn: true });
      expect(gate.consumeClerkSignInRequest()).toBe(true);
      expect(open).not.toHaveBeenCalled();
    },
  );

  it("keeps development keys usable in a local browser", async () => {
    browser("http://localhost:7370/");
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", `pk_test_${btoa("example.clerk.accounts.dev$")}`);
    const gate = await import("./clerkGate");
    expect(gate.isClerkGateOpen()).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it("keeps the packaged Electron client on its native SDK", async () => {
    browser("t3code://app/#/welcome");
    window.desktopBridge = {} as DesktopBridge;
    const gate = await import("./clerkGate");
    expect(gate.isClerkGateOpen()).toBe(true);
    gate.openClerkGate({ promptSignIn: true });
    expect(gate.consumeClerkSignInRequest()).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it("does not replace a fork's custom Clerk instance with the official service", async () => {
    browser("https://fork.example.test/");
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", `pk_live_${btoa("clerk.fork.example.test$")}`);
    const gate = await import("./clerkGate");
    expect(gate.isClerkGateOpen()).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });
});
