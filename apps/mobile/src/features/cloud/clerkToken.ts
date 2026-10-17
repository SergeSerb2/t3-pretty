import { ManagedRelay } from "@t3tools/client-runtime/relay";
import { CONNECT_BRANDING } from "@t3tools/shared/connectBranding";

export async function readClerkTokenWithDeadline(
  readToken: () => Promise<string | null>,
): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      readToken(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () =>
            reject(
              new Error(
                `Timed out while reading the ${CONNECT_BRANDING.connectName} session token.`,
              ),
            ),
          ManagedRelay.MANAGED_RELAY_REQUEST_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}
