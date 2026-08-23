import type { DesktopBridge } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

// isElectron is read at module load, so the desktop bridge has to exist before
// the gate module is imported.
function stubDesktopWindow(storedFlag?: string): void {
  const target = (globalThis.window ?? globalThis) as Window & typeof globalThis;
  if (globalThis.window === undefined) {
    Object.defineProperty(globalThis, "window", { value: target, configurable: true });
  }
  target.desktopBridge = {} as DesktopBridge;
  const store = new Map<string, string>();
  if (storedFlag !== undefined) store.set("t3code:desktop-clerk-enabled:v1", storedFlag);
  Object.defineProperty(target, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
    },
  });
}

describe("desktop clerk gate", () => {
  it("stays closed until a sign-in surface opens it, and remembers that", async () => {
    // "0" is what a launch that saw no Clerk session leaves behind; an unwritten
    // flag deliberately loads the provider once to find out.
    stubDesktopWindow("0");
    const gate = await import("./clerkGate");

    expect(gate.isClerkGateOpen()).toBe(false);

    let notified = 0;
    const unsubscribe = gate.subscribeToClerkGate(() => {
      notified += 1;
    });
    gate.openClerkGate({ promptSignIn: true });
    unsubscribe();

    expect(notified).toBe(1);
    expect(gate.isClerkGateOpen()).toBe(true);
    expect(window.localStorage.getItem(gate.CLERK_GATE_STORAGE_KEY)).toBe("1");
    // The click that opened the gate is carried through the provider mount once.
    expect(gate.consumeClerkSignInRequest()).toBe(true);
    expect(gate.consumeClerkSignInRequest()).toBe(false);

    // Signing out only affects the next launch: remounting the provider mid
    // session would remount the whole tree for no gain.
    gate.closeClerkGateForNextLaunch();
    expect(window.localStorage.getItem(gate.CLERK_GATE_STORAGE_KEY)).toBe("0");
    expect(gate.isClerkGateOpen()).toBe(true);
  });
});
