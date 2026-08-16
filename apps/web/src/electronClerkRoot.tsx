import type { ReactNode } from "react";
import { useEffect } from "react";
import { passkeys } from "@clerk/electron/passkeys";
import { ClerkProvider, useClerk } from "@clerk/electron/react";

import { clerkAppearance } from "./components/clerk/clerkAppearance";
import { consumeClerkSignInRequest } from "./cloud/clerkGate";
import { resolveClerkSignInProps } from "./components/clerk/authRedirect";

// Loaded lazily from main.tsx so @clerk/clerk-js (bundled by @clerk/electron)
// only ships to the desktop renderer, not to browser builds that never use it,
// and only once the install has a cloud session (see cloud/clerkGate).
export default function ElectronClerkRoot({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: ReactNode;
}) {
  return (
    <ClerkProvider appearance={clerkAppearance} publishableKey={publishableKey} passkeys={passkeys}>
      <PendingSignInPrompt />
      {children}
    </ClerkProvider>
  );
}

/**
 * Finishes the click that mounted this provider. Clerk queues method calls
 * made before clerk-js finishes loading, so opening the dialog here needs no
 * readiness check.
 */
function PendingSignInPrompt() {
  const clerk = useClerk();

  useEffect(() => {
    if (!consumeClerkSignInRequest()) return;
    clerk.openSignIn(resolveClerkSignInProps(window.location.href, true));
  }, [clerk]);

  return null;
}
