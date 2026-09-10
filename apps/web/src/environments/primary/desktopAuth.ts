// One in-flight mint is shared across renderer HTTP calls. A hung IPC
// (Electron failing to clone a main-process Effect rejection) used to pin
// this promise forever and leave #boot-shell up after the backend was ready.
export const DESKTOP_BEARER_TOKEN_TIMEOUT_MS = 10_000;

let desktopBearerTokenPromise: Promise<string> | null = null;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("Timed out waiting for the desktop local bearer token."));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function readDesktopPrimaryBearerToken(): Promise<string | null> {
  if (typeof window === "undefined") {
    return Promise.resolve(null);
  }
  const bridge = window.desktopBridge;
  if (!bridge) {
    return Promise.resolve(null);
  }

  desktopBearerTokenPromise ??= withTimeout(
    bridge.getLocalEnvironmentBearerToken(),
    DESKTOP_BEARER_TOKEN_TIMEOUT_MS,
  ).catch((error) => {
    desktopBearerTokenPromise = null;
    throw error;
  });
  return desktopBearerTokenPromise;
}

export function __resetDesktopPrimaryAuthForTests(): void {
  desktopBearerTokenPromise = null;
}
