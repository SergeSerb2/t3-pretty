import { it as itEffect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";
import { describe, expect, it } from "vite-plus/test";

import { cursorChecksum, makeGrokBotClient, parseSseChunk } from "./GrokBotGateway.ts";

/** Fake Cursor API + box: `EnsureSandBox` points at a box whose `/events` streams SSE chunks. */
const fakeHttp = (chunks: ReadonlyArray<string>) =>
  HttpClient.make((request, url) => {
    if (url.pathname.endsWith("/EnsureSandBox")) {
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json({ gatewayUrl: "https://box.test", gatewayToken: "gt", networkToken: "nt" }),
        ),
      );
    }
    expect(url.toString()).toBe("https://box.test/events");
    expect(request.headers.authorization).toBe("Bearer gt");
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return Effect.succeed(
      HttpClientResponse.fromWeb(
        request,
        new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
      ),
    );
  });

describe("GrokBotGateway", () => {
  itEffect.effect("streams parsed gateway events from a live /events response", () =>
    Effect.gen(function* () {
      const client = yield* makeGrokBotClient({
        accessToken: Effect.succeed("cursor-token"),
        machineId: "ab".repeat(32),
      });
      const events = yield* client.events.pipe(Stream.runCollect);
      expect(Array.from(events)).toEqual([
        { channel: "box-disk-pressure", payload: null },
        { channel: "agent-upserted", payload: { agent: { id: "a1", isRunningTurn: true } } },
      ]);
    }).pipe(
      Effect.provideService(
        HttpClient.HttpClient,
        fakeHttp([
          "retry: 1000\n\n",
          'data: {"channel":"box-disk-pressure","payload":null}\n\n:ping\n\ndata: {"channel":"agent-upserted","pay',
          'load":{"agent":{"id":"a1","isRunningTurn":true}}}\n\n',
        ]),
      ),
    ),
  );

  it("builds the x-cursor-checksum the desktop app would send", () => {
    // Same obfuscation as the desktop bundle: six timestamp bytes, XOR-chained
    // from 165 with the index added, base64url, then the machine id verbatim.
    const machineId = "ab".repeat(32);
    const checksum = cursorChecksum(machineId, 1_788_900_000_000);
    expect(checksum.endsWith(machineId)).toBe(true);
    expect(checksum.slice(0, -machineId.length)).toBe("7gsNGVa3");
  });

  it("parses SSE data frames across chunk boundaries and skips comments", () => {
    const [buffer1, events1] = parseSseChunk(
      "",
      'retry: 1000\n\n:ping\n\ndata: {"channel":"a","payload":1}\n\ndata: {"chan',
    );
    expect(events1).toEqual([{ channel: "a", payload: 1 }]);
    expect(buffer1).toBe('data: {"chan');

    const [buffer2, events2] = parseSseChunk(buffer1, 'nel":"b","payload":{"x":2}}\n\n');
    expect(events2).toEqual([{ channel: "b", payload: { x: 2 } }]);
    expect(buffer2).toBe("");
  });

  it("accepts CRLF framing, including a CR split from its LF by a chunk boundary", () => {
    const [buffer1, events1] = parseSseChunk("", 'data: {"channel":"a","payload":1}\r\n\r');
    expect(events1).toEqual([]);
    const [buffer2, events2] = parseSseChunk(
      buffer1,
      '\ndata: {"channel":"b","payload":2}\r\n\r\n',
    );
    expect(events2).toEqual([
      { channel: "a", payload: 1 },
      { channel: "b", payload: 2 },
    ]);
    expect(buffer2).toBe("");
  });

  it("drops frames that are not gateway events", () => {
    const [, events] = parseSseChunk("", 'data: not json\n\ndata: {"payload":1}\n\n');
    expect(events).toEqual([]);
  });
});
