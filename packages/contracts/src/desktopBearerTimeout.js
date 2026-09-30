// Shared desktop local-bearer budget. The renderer IPC timeout must cover the
// main-process ready latch plus /oauth/token retries, with slack for Electron
// failing to clone a late Effect rejection. Windows first listen can exceed
// 30s (AV + server.asar), so these must stay well above that floor.
//
// Plain JS so Node smokes can import the same values without type-stripping.
export const DESKTOP_LOCAL_BEARER_READY_TIMEOUT_MS = 90_000;
export const DESKTOP_LOCAL_BEARER_EXCHANGE_RETRY_TIMEOUT_MS = 8_000;
export const DESKTOP_LOCAL_BEARER_TOKEN_TIMEOUT_MS =
  DESKTOP_LOCAL_BEARER_READY_TIMEOUT_MS + DESKTOP_LOCAL_BEARER_EXCHANGE_RETRY_TIMEOUT_MS + 2_000;
