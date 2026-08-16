/**
 * Keeps clerk-js off the desktop boot path until the install actually has a
 * cloud account. `@clerk/electron` bundles clerk-js into the renderer chunk
 * (~1.5 MB of parse) and the provider wraps the whole tree, so every desktop
 * launch used to block its first paint on code that a never-signed-in install
 * never calls.
 *
 * The gate is a persisted, install-level flag rather than session state: it
 * opens when a sign-in surface is used and closes when Clerk reports a signed
 * out session, so a returning signed-in user still gets the provider on the
 * first render of the next launch. An unwritten flag means "not known yet" and
 * loads the provider: an install that was already signed in when this landed
 * must not silently lose its relay session, so the answer is paid for once and
 * recorded. Browsers are unaffected — there the provider loads clerk-js from
 * Clerk's CDN, not from our bundle.
 *
 * Opening the gate mid-session mounts a provider above the app, which remounts
 * the tree once. That is deliberate: the alternative is paying the parse on
 * every boot to keep one rare, explicitly requested transition seamless.
 */
import { useSyncExternalStore } from "react";

import { isElectron } from "../env";
import { hasCloudPublicConfig } from "./publicConfig";

export const CLERK_GATE_STORAGE_KEY = "t3code:desktop-clerk-enabled:v1";

const listeners = new Set<() => void>();

function readStoredFlag(): boolean {
  try {
    // Only an explicit "no session here" closes the gate.
    return window.localStorage.getItem(CLERK_GATE_STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

// Browsers always render the provider; only the desktop bundle pays for it.
let open = !isElectron || readStoredFlag();
let signInRequested = false;

function writeStoredFlag(next: boolean): void {
  try {
    window.localStorage.setItem(CLERK_GATE_STORAGE_KEY, next ? "1" : "0");
  } catch {
    // A blocked storage partition only costs the next launch's head start.
  }
}

function setOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  for (const listener of listeners) listener();
}

export function isClerkGateOpen(): boolean {
  return open;
}

export function subscribeToClerkGate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Mount the Clerk provider (now, and on every later launch). `promptSignIn`
 * carries the click that opened the gate through the provider mount, so the
 * sign-in dialog opens once clerk-js is loaded instead of asking for a second
 * click.
 */
export function openClerkGate(options?: { readonly promptSignIn?: boolean }): void {
  if (options?.promptSignIn) signInRequested = true;
  writeStoredFlag(true);
  setOpen(true);
}

/** Called when Clerk reports no session, so the next launch skips clerk-js. */
export function closeClerkGateForNextLaunch(): void {
  if (!isElectron) return;
  writeStoredFlag(false);
}

/** Called once the provider is mounted; true when a sign-in prompt is owed. */
export function consumeClerkSignInRequest(): boolean {
  const requested = signInRequested;
  signInRequested = false;
  return requested;
}

/** True once the Clerk provider is mounted (always true outside Electron). */
export function useClerkGateOpen(): boolean {
  return useSyncExternalStore(subscribeToClerkGate, isClerkGateOpen, isClerkGateOpen);
}

/**
 * The guard for anything that reads Clerk state: the build must carry cloud
 * configuration *and* the provider must be mounted.
 */
export function useCloudUiEnabled(): boolean {
  const gateOpen = useClerkGateOpen();
  return hasCloudPublicConfig() && gateOpen;
}
