import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { PrimaryConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { remoteHttpClientLayer } from "../rpc/http.ts";
import { readAloudChunks, readAloudPlainText, synthesizeReadAloud } from "./readAloud.ts";

const target = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test/base",
  wsBaseUrl: "wss://environment.example.test",
});

const prepared: PreparedConnection = {
  environmentId: target.environmentId,
  label: target.label,
  httpBaseUrl: target.httpBaseUrl,
  socketUrl: "wss://environment.example.test/ws",
  httpAuthorization: null,
  target,
};

describe("read aloud text", () => {
  it("turns common markdown into natural plain text", () => {
    expect(
      readAloudPlainText(
        "# Result\nRead [the docs](https://example.com), then run `vp test`.\n```ts\nconst hidden = true;\n```\n- First check\n- Second check",
      ),
    ).toBe("Result. Read the docs, then run vp test. First check. Second check");
  });

  it("splits long responses at natural boundaries within Groq's limit", () => {
    const markdown = `${"A natural opening sentence with useful detail. ".repeat(5)}${"word ".repeat(80)}`;
    const chunks = readAloudChunks(markdown);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length > 0 && chunk.length <= 200)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(readAloudPlainText(markdown));
  });

  it("recognizes content with no readable text", () => {
    expect(readAloudChunks("https://example.com/image.png")).toEqual([]);
  });
});

describe("synthesizeReadAloud", () => {
  it.effect("routes speech generation through the prepared environment endpoint", () =>
    Effect.gen(function* () {
      const calls: Array<readonly [RequestInfo | URL, RequestInit]> = [];
      const fetchFn = ((request, init) => {
        calls.push([request, init ?? {}]);
        return Promise.resolve(Response.json({ audioBase64: "UklGRg==", mimeType: "audio/wav" }));
      }) satisfies typeof fetch;

      const result = yield* synthesizeReadAloud({ prepared, text: "Read this response." }).pipe(
        Effect.provide(remoteHttpClientLayer(fetchFn)),
      );

      expect(result).toEqual({ audioBase64: "UklGRg==", mimeType: "audio/wav" });
      expect(String(calls[0]?.[0])).toBe(
        "https://environment.example.test/api/read-aloud/synthesize",
      );
      expect(calls[0]?.[1]).toMatchObject({ method: "POST", credentials: "include" });
    }),
  );
});
