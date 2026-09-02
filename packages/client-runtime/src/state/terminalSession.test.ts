import { describe, expect, it } from "vite-plus/test";

import { EnvironmentId, TerminalSessionSnapshot, ThreadId } from "@t3tools/contracts";

import {
  applyTerminalAttachStreamEvent,
  applyTerminalMetadataStreamEvent,
  combineTerminalSessionState,
  EMPTY_TERMINAL_BUFFER_STATE,
  selectRunningSubprocessTerminalIds,
  terminalBufferAppendSince,
} from "./terminalSession.ts";

const TARGET = {
  environmentId: EnvironmentId.make("env-local"),
  threadId: ThreadId.make("thread-1"),
  terminalId: "term-1",
} as const;

const BASE_SNAPSHOT: TerminalSessionSnapshot = {
  threadId: TARGET.threadId,
  terminalId: TARGET.terminalId,
  cwd: "/repo",
  worktreePath: null,
  status: "running",
  pid: 123,
  history: "hello",
  exitCode: null,
  exitSignal: null,
  label: "Terminal 1",
  updatedAt: "2026-04-01T00:00:00.000Z",
};

describe("terminal session reducers", () => {
  it("prefers live attach status over stale metadata after the attach stream starts", () => {
    const summary = applyTerminalMetadataStreamEvent([], {
      type: "snapshot",
      terminals: [
        {
          threadId: BASE_SNAPSHOT.threadId,
          terminalId: BASE_SNAPSHOT.terminalId,
          cwd: BASE_SNAPSHOT.cwd,
          worktreePath: BASE_SNAPSHOT.worktreePath,
          status: "running",
          pid: BASE_SNAPSHOT.pid,
          exitCode: BASE_SNAPSHOT.exitCode,
          exitSignal: BASE_SNAPSHOT.exitSignal,
          updatedAt: BASE_SNAPSHOT.updatedAt,
          hasRunningSubprocess: false,
          label: BASE_SNAPSHOT.label,
        },
      ],
    })[0]!;
    const attached = applyTerminalAttachStreamEvent(EMPTY_TERMINAL_BUFFER_STATE, {
      type: "error",
      threadId: TARGET.threadId,
      terminalId: TARGET.terminalId,
      message: "Terminal disconnected.",
    });

    expect(combineTerminalSessionState(summary, attached)).toMatchObject({
      status: "error",
      error: "Terminal disconnected.",
      version: 1,
    });
  });

  it("uses metadata status before an attach stream has emitted", () => {
    const summary = applyTerminalMetadataStreamEvent([], {
      type: "snapshot",
      terminals: [
        {
          threadId: BASE_SNAPSHOT.threadId,
          terminalId: BASE_SNAPSHOT.terminalId,
          cwd: BASE_SNAPSHOT.cwd,
          worktreePath: BASE_SNAPSHOT.worktreePath,
          status: "running",
          pid: BASE_SNAPSHOT.pid,
          exitCode: BASE_SNAPSHOT.exitCode,
          exitSignal: BASE_SNAPSHOT.exitSignal,
          updatedAt: BASE_SNAPSHOT.updatedAt,
          hasRunningSubprocess: false,
          label: BASE_SNAPSHOT.label,
        },
      ],
    })[0]!;

    expect(combineTerminalSessionState(summary, EMPTY_TERMINAL_BUFFER_STATE).status).toBe(
      "running",
    );
  });

  it("prefers a valid latest timestamp regardless of which stream supplies it", () => {
    const validTimestamp = "2026-04-02T00:00:00.000Z";
    const malformedTimestamp = "not-a-timestamp";
    const summary = applyTerminalMetadataStreamEvent([], {
      type: "snapshot",
      terminals: [
        {
          threadId: BASE_SNAPSHOT.threadId,
          terminalId: BASE_SNAPSHOT.terminalId,
          cwd: BASE_SNAPSHOT.cwd,
          worktreePath: BASE_SNAPSHOT.worktreePath,
          status: "running",
          pid: BASE_SNAPSHOT.pid,
          exitCode: BASE_SNAPSHOT.exitCode,
          exitSignal: BASE_SNAPSHOT.exitSignal,
          updatedAt: validTimestamp,
          hasRunningSubprocess: false,
          label: BASE_SNAPSHOT.label,
        },
      ],
    })[0]!;

    expect(
      combineTerminalSessionState(summary, {
        ...EMPTY_TERMINAL_BUFFER_STATE,
        updatedAt: malformedTimestamp,
      }).updatedAt,
    ).toBe(validTimestamp);
    expect(
      combineTerminalSessionState(
        { ...summary, updatedAt: malformedTimestamp },
        { ...EMPTY_TERMINAL_BUFFER_STATE, updatedAt: validTimestamp },
      ).updatedAt,
    ).toBe(validTimestamp);
  });

  it("does not treat an idle running shell as a running subprocess", () => {
    const idleSession = {
      target: TARGET,
      state: {
        ...combineTerminalSessionState(null, EMPTY_TERMINAL_BUFFER_STATE),
        status: "running" as const,
        hasRunningSubprocess: false,
      },
    };
    const activeSession = {
      target: { ...TARGET, terminalId: "term-2" },
      state: {
        ...idleSession.state,
        hasRunningSubprocess: true,
      },
    };

    expect(selectRunningSubprocessTerminalIds([idleSession, activeSession])).toEqual(["term-2"]);
  });

  it("reduces attach snapshots and output without an imperative session manager", () => {
    const snapshot = applyTerminalAttachStreamEvent(EMPTY_TERMINAL_BUFFER_STATE, {
      type: "snapshot",
      snapshot: BASE_SNAPSHOT,
    });
    const output = applyTerminalAttachStreamEvent(
      snapshot,
      {
        type: "output",
        threadId: TARGET.threadId,
        terminalId: TARGET.terminalId,
        data: " world",
      },
      8,
    );

    expect(output).toMatchObject({
      buffer: "lo world",
      status: "running",
      error: null,
      version: 2,
    });
  });

  it("reduces terminal metadata snapshots, upserts, and removals", () => {
    const initial = applyTerminalMetadataStreamEvent([], {
      type: "snapshot",
      terminals: [
        {
          threadId: BASE_SNAPSHOT.threadId,
          terminalId: BASE_SNAPSHOT.terminalId,
          cwd: BASE_SNAPSHOT.cwd,
          worktreePath: BASE_SNAPSHOT.worktreePath,
          status: BASE_SNAPSHOT.status,
          pid: BASE_SNAPSHOT.pid,
          exitCode: BASE_SNAPSHOT.exitCode,
          exitSignal: BASE_SNAPSHOT.exitSignal,
          updatedAt: BASE_SNAPSHOT.updatedAt,
          hasRunningSubprocess: false,
          label: BASE_SNAPSHOT.label,
        },
      ],
    });
    const updated = applyTerminalMetadataStreamEvent(initial, {
      type: "upsert",
      terminal: {
        ...initial[0]!,
        hasRunningSubprocess: true,
      },
    });
    const removed = applyTerminalMetadataStreamEvent(updated, {
      type: "remove",
      threadId: TARGET.threadId,
      terminalId: TARGET.terminalId,
    });

    expect(updated).toHaveLength(1);
    expect(updated[0]?.hasRunningSubprocess).toBe(true);
    expect(removed).toEqual([]);
  });

  it("caps retained output by UTF-8 byte length", () => {
    const state = applyTerminalAttachStreamEvent(
      EMPTY_TERMINAL_BUFFER_STATE,
      {
        type: "output",
        threadId: TARGET.threadId,
        terminalId: TARGET.terminalId,
        data: "🙂🙂",
      },
      4,
    );

    expect(state.buffer).toBe("🙂");
  });

  it("counts a surrogate pair split across output chunks as one code point", () => {
    const append = (state: typeof EMPTY_TERMINAL_BUFFER_STATE, data: string) =>
      applyTerminalAttachStreamEvent(
        state,
        {
          type: "output",
          threadId: TARGET.threadId,
          terminalId: TARGET.terminalId,
          data,
        },
        4,
      );

    const highSurrogate = append(EMPTY_TERMINAL_BUFFER_STATE, "\ud83d");
    const pair = append(highSurrogate, "\ude42");

    expect(pair.buffer).toBe("🙂");
    expect(pair.bufferByteLength).toBe(4);
  });

  it("keeps a long output stream byte-trimmed across chunk appends", () => {
    let state = EMPTY_TERMINAL_BUFFER_STATE;
    // 200 chunks x 6 bytes = 1200 bytes streamed through a 64-byte cap.
    for (let index = 0; index < 200; index += 1) {
      state = applyTerminalAttachStreamEvent(
        state,
        {
          type: "output",
          threadId: TARGET.threadId,
          terminalId: TARGET.terminalId,
          data: "abcdef",
        },
        64,
      );
    }

    expect(state.buffer).toBe(`cdef${"abcdef".repeat(10)}`);
    expect(state.bufferByteLength).toBe(64);
    expect(state.version).toBe(200);
  });

  it("exposes only new output after the retained buffer rolls over", () => {
    const append = (state: typeof EMPTY_TERMINAL_BUFFER_STATE, data: string) =>
      applyTerminalAttachStreamEvent(
        state,
        {
          type: "output",
          threadId: TARGET.threadId,
          terminalId: TARGET.terminalId,
          data,
        },
        8,
      );

    const previous = append(EMPTY_TERMINAL_BUFFER_STATE, "abcdefgh");
    const current = append(previous, "ij");

    expect(current.buffer).toBe("cdefghij");
    expect(terminalBufferAppendSince(previous, current)).toBe("ij");
  });

  it("requests a reset when output outruns the retained window or the stream restarts", () => {
    const previous = applyTerminalAttachStreamEvent(
      EMPTY_TERMINAL_BUFFER_STATE,
      {
        type: "output",
        threadId: TARGET.threadId,
        terminalId: TARGET.terminalId,
        data: "abcdefgh",
      },
      8,
    );
    const overrun = applyTerminalAttachStreamEvent(
      previous,
      {
        type: "output",
        threadId: TARGET.threadId,
        terminalId: TARGET.terminalId,
        data: "ijklmnop",
      },
      8,
    );
    const restarted = applyTerminalAttachStreamEvent(previous, {
      type: "restarted",
      threadId: TARGET.threadId,
      terminalId: TARGET.terminalId,
      snapshot: { ...BASE_SNAPSHOT, history: "fresh" },
    });

    expect(terminalBufferAppendSince(previous, overrun)).toBeNull();
    expect(terminalBufferAppendSince(previous, restarted)).toBeNull();
  });

  it("drops a multi-byte character straddling the trim boundary whole", () => {
    const append = (state: typeof EMPTY_TERMINAL_BUFFER_STATE, data: string) =>
      applyTerminalAttachStreamEvent(
        state,
        {
          type: "output",
          threadId: TARGET.threadId,
          terminalId: TARGET.terminalId,
          data,
        },
        8,
      );

    // Steady-state appends at or under the cap accumulate untouched.
    let state = append(EMPTY_TERMINAL_BUFFER_STATE, "abcd");
    state = append(state, "efgh");
    expect(state.buffer).toBe("abcdefgh");
    expect(state.bufferByteLength).toBe(8);

    state = append(state, "🙂");
    expect(state.buffer).toBe("efgh🙂");

    state = append(state, "ij");
    expect(state.buffer).toBe("gh🙂ij");

    // The trim boundary lands inside the first emoji; it is dropped whole
    // rather than decoded as a partial sequence.
    state = append(state, "🙂");
    expect(state.buffer).toBe("ij🙂");
    expect(state.bufferByteLength).toBe(6);
  });
});
