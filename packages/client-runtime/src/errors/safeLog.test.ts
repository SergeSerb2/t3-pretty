import { describe, expect, it } from "vite-plus/test";

import { safeErrorLogAttributes } from "./safeLog.ts";

describe("safeErrorLogAttributes", () => {
  it("keeps correlation and stack frames without serializing messages or nested causes", () => {
    const cause = Object.assign(new Error("nested-cause-secret-sentinel"), {
      traceId: "trace-safe-123",
    });
    const error = Object.assign(new Error("outer-error-secret-sentinel", { cause }), {
      _tag: "ProjectRemovalError",
    });
    error.stack = [
      "ProjectRemovalError: outer-error-secret-sentinel",
      "    at removeProject (https://user:password@example.com/project.ts?token=secret#fragment)",
    ].join("\n");

    const attributes = safeErrorLogAttributes(error);

    expect(attributes).toMatchObject({
      errorType: "error",
      errorName: "Error",
      errorTag: "ProjectRemovalError",
      traceId: "trace-safe-123",
      stack: "    at removeProject (https://example.com/project.ts)",
    });
    const diagnosticText = Object.values(attributes).map(String).join("\n");
    expect(diagnosticText).not.toContain("outer-error-secret-sentinel");
    expect(diagnosticText).not.toContain("nested-cause-secret-sentinel");
    expect(diagnosticText).not.toContain("user:password");
    expect(diagnosticText).not.toContain("token=secret");
  });

  it("does not trust arbitrary object messages or tags", () => {
    const attributes = safeErrorLogAttributes({
      _tag: "payload-secret-sentinel",
      message: "message-secret-sentinel",
      cause: { traceId: "trace id with unsafe whitespace" },
    });

    expect(attributes).toEqual({ errorType: "object" });
  });

  it("skips an unsafe outer trace id when a nested safe trace id is available", () => {
    const attributes = safeErrorLogAttributes({
      traceId: "unsafe trace id",
      cause: { traceId: "trace-safe-inner" },
    });

    expect(attributes).toEqual({
      errorType: "object",
      traceId: "trace-safe-inner",
    });
  });

  it("bounds hostile cause traversal", () => {
    let causeReads = 0;
    const makeNode = (): object =>
      new Proxy(
        {},
        {
          get(_target, property) {
            if (property === "cause") {
              causeReads += 1;
              return makeNode();
            }
            return undefined;
          },
        },
      );

    expect(safeErrorLogAttributes(makeNode())).toEqual({ errorType: "object" });
    expect(causeReads).toBeLessThanOrEqual(128);
  });

  it("bounds stack work and scrubs malformed stack URLs", () => {
    const error = new Error("secret");
    error.stack = Array.from(
      { length: 1_000 },
      (_, index) =>
        `    at frame${index} (https://user:password@%zz.test/file.ts?token=secret#fragment)`,
    ).join("\n");

    const stack = safeErrorLogAttributes(error).stack ?? "";
    expect(stack.split("\n")).toHaveLength(32);
    expect(stack).not.toContain("user:password");
    expect(stack).not.toContain("token=secret");
  });
});
