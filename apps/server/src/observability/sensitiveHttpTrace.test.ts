import { describe, expect, it } from "vite-plus/test";

import { shouldDisableHttpServerTracing } from "./sensitiveHttpTrace.ts";

describe("shouldDisableHttpServerTracing", () => {
  it("disables spans whose query or path contains a signed capability", () => {
    expect(shouldDisableHttpServerTracing("/ws?wsTicket=signed-ticket")).toBe(true);
    expect(shouldDisableHttpServerTracing("/api/assets/signed-token/file.png")).toBe(true);
    expect(shouldDisableHttpServerTracing("https://host.test/api/assets/token/file.png?q=1")).toBe(
      true,
    );
  });

  it("keeps ordinary server routes traced", () => {
    expect(shouldDisableHttpServerTracing("/api/auth/session")).toBe(false);
    expect(shouldDisableHttpServerTracing("/api/assets-other/token")).toBe(false);
  });
});
