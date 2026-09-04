// @effect-diagnostics nodeBuiltinImport:off
import { assert, describe, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import {
  listTranscriptFiles,
  readTranscriptRecords,
  readUtf8LinesWithinLimit,
} from "./usageTranscriptReader.ts";

const encoder = new TextEncoder();

async function collectLines(chunks: readonly Uint8Array[], maxLineBytes: number) {
  async function* input() {
    for (const chunk of chunks) yield chunk;
  }

  const lines: string[] = [];
  let oversizedLines = 0;
  for await (const line of readUtf8LinesWithinLimit(
    input(),
    maxLineBytes,
    () => oversizedLines++,
  )) {
    lines.push(line);
  }
  return { lines, oversizedLines };
}

describe("readUtf8LinesWithinLimit", () => {
  it("frames lines across chunks, strips CRLF, and keeps a final unterminated line", async () => {
    const lines = await collectLines(
      [encoder.encode("first\r"), encoder.encode("\nsecond\nthird")],
      32,
    );

    assert.deepStrictEqual(lines, { lines: ["first", "second", "third"], oversizedLines: 0 });
  });

  it("drops only an oversized line and resumes after its newline", async () => {
    const lines = await collectLines(
      [encoder.encode("ok\n12345"), encoder.encode("67890\nafter\n")],
      8,
    );

    assert.deepStrictEqual(lines, { lines: ["ok", "after"], oversizedLines: 1 });
  });

  it("applies the limit to UTF-8 bytes rather than JavaScript characters", async () => {
    const lines = await collectLines([encoder.encode("🙂🙂\nkept")], 7);

    assert.deepStrictEqual(lines, { lines: ["kept"], oversizedLines: 1 });
  });
});

describe("listTranscriptFiles", () => {
  it("streams nested directories and reports a conservative file limit", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-usage-listing-"));
    try {
      await NodeFSP.mkdir(NodePath.join(root, "nested"));
      await NodeFSP.writeFile(NodePath.join(root, "first.jsonl"), "{}\n");
      await NodeFSP.writeFile(NodePath.join(root, "nested", "second.jsonl"), "{}\n");

      const listing = await listTranscriptFiles(root, 0, undefined, {
        maxFiles: 1,
        maxDirectories: 4,
        maxEntries: 10,
      });

      assert.lengthOf(listing.files, 1);
      assert.isTrue(listing.truncated);
      assert.strictEqual(listing.unreadableDirectories, 0);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});

describe("readTranscriptRecords", () => {
  it("stops at the caller's record budget and reports a partial parse", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-usage-records-"));
    const transcript = NodePath.join(root, "session.jsonl");
    const line = JSON.stringify({
      type: "assistant",
      timestamp: "2026-08-23T12:00:00.000Z",
      sessionId: "session-1",
      message: {
        id: "message-1",
        model: "claude-test",
        usage: { input_tokens: 1, output_tokens: 1 },
      },
    });
    try {
      await NodeFSP.writeFile(transcript, `${line}\n${line}\n`);

      const result = await readTranscriptRecords(transcript, "claude", 1);

      assert.isNotNull(result);
      assert.lengthOf(result?.records ?? [], 1);
      assert.isTrue(result?.recordLimitReached);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });

  it("reads every Grok model on a line up to the record budget", async () => {
    const root = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-usage-grok-records-"));
    const transcript = NodePath.join(root, "updates.jsonl");
    const line = JSON.stringify({
      timestamp: 1_786_372_566,
      params: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "turn_completed",
          prompt_id: "prompt-1",
          usage: {
            inputTokens: 2,
            outputTokens: 2,
            modelUsage: {
              "grok-4.5": { inputTokens: 1, outputTokens: 1 },
              "grok-4.6": { inputTokens: 1, outputTokens: 1 },
            },
          },
        },
      },
    });
    try {
      await NodeFSP.writeFile(transcript, `${line}\n`);

      const full = await readTranscriptRecords(transcript, "grok", 2);
      const bounded = await readTranscriptRecords(transcript, "grok", 1);

      assert.deepEqual(
        full?.records.map((record) => record.model),
        ["grok-4.5", "grok-4.6"],
      );
      assert.lengthOf(bounded?.records ?? [], 1);
      assert.isTrue(bounded?.recordLimitReached);
    } finally {
      await NodeFSP.rm(root, { recursive: true, force: true });
    }
  });
});
