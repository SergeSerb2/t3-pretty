import type { ReactNode } from "react";
import { passkeys } from "@clerk/electron/passkeys";
import { ClerkProvider } from "@clerk/electron/react";

import { clerkAppearance } from "./components/clerk/clerkAppearance";

// Loaded lazily from main.tsx so @clerk/clerk-js (bundled by @clerk/electron)
// only ships to the desktop renderer, not to browser builds that never use it.
export default function ElectronClerkRoot({
  publishableKey,
  children,
}: {
  publishableKey: string;
  children: ReactNode;
}) {
  return (
    <ClerkProvider appearance={clerkAppearance} publishableKey={publishableKey} passkeys={passkeys}>
      {children}
    </ClerkProvider>
  );
}
