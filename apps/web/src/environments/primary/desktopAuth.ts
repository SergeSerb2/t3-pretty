import * as Schema from "effect/Schema";

// One in-flight mint is shared across renderer HTTP calls. A hung IPC
// (Electron failing to clone a main-process Effect rejection) used to pin
// this promise forever and leave #boot-shell up after the backend was ready.
// Must cover main waitForReady (30s) + /oauth/token retries (8s); a shorter
// timeout fail-opens splash while the child is still coming up.
export const DESKTOP_BEARER_TOKEN_TIMEOUT_MS = 40_000;

export class PrimaryEnvironmentDesktopBearerTimeoutError extends Schema.TaggedErrorClass<PrimaryEnvironmentDesktopBearerTimeoutError>()(
  "PrimaryEnvironmentDesktopBearerTimeoutError",
  { timeoutMs: Schema.Number },
) {
  override get message(): string {
    return "Timed out waiting for the desktop local bearer token.";
  }
}

export const isPrimaryEnvironmentDesktopBearerTimeoutError = Schema.is(
  PrimaryEnvironmentDesktopBearerTimeoutError,
);

let desktopAuthDeadlineAt: number | null = null;
let desktopBearerTokenPromise: Promise<string> | null = null;

export function beginDesktopAuthDeadline(startedAt = Date.now()): void {
  desktopAuthDeadlineAt = startedAt + DESKTOP_BEARER_TOKEN_TIMEOUT_MS;
}

export function remainingDesktopAuthBudgetMs(): number {
  if (desktopAuthDeadlineAt === null) {
    return DESKTOP_BEARER_TOKEN_TIMEOUT_MS;
  }
  return Math.max(0, desktopAuthDeadlineAt - Date.now());
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new PrimaryEnvironmentDesktopBearerTimeoutError({ timeoutMs }));
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
    remainingDesktopAuthBudgetMs(),
  ).catch((error) => {
    desktopBearerTokenPromise = null;
    throw error;
  });
  return desktopBearerTokenPromise;
}

export function __resetDesktopPrimaryAuthForTests(): void {
  desktopBearerTokenPromise = null;
  desktopAuthDeadlineAt = null;
}
