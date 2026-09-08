import { describe, expect, it } from "vite-plus/test";

import { cursorChecksum, parseSseChunk } from "./GrokBotGateway.ts";

describe("GrokBotGateway", () => {
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
