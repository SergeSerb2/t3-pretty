// @effect-diagnostics nodeBuiltinImport:off -- The SDK must load from disk beside its Webpack chunks.
import * as NodeModule from "node:module";

type CursorSdkModule = typeof import("@cursor/sdk");
type CursorSdkSqliteModule = typeof import("@cursor/sdk/sqlite");

// Cursor's Webpack chunks and local helpers must stay beside the SDK entry.
// createRequire also loads that disk-backed package from a Node SEA executable.
const requireCursorSdk = NodeModule.createRequire(import.meta.url);

let sdk: CursorSdkModule | undefined;
let sqlite: CursorSdkSqliteModule | undefined;

// The SDK is several megabytes of JavaScript. Load it on first use so servers
// that never run Cursor keep it off their boot path and out of memory.
export function loadCursorSdk(): CursorSdkModule {
  sdk ??= requireCursorSdk("@cursor/sdk") as CursorSdkModule;
  return sdk;
}

export function loadCursorSdkSqlite(): CursorSdkSqliteModule {
  sqlite ??= requireCursorSdk("@cursor/sdk/sqlite") as CursorSdkSqliteModule;
  return sqlite;
}
