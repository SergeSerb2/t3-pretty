import { describe, expect, it } from "vite-plus/test";

import { describeActivity, gatewaySignals } from "./GrokBotEvents.ts";

const agentId = "b47db307-2b88-4988-bb81-0d3c302355f3";

describe("GrokBotEvents", () => {
  it("surfaces bot text and interactive cards from transcript events", () => {
    const text = gatewaySignals({
      channel: "transcript",
      payload: {
        type: "appended",
        agentId,
        entry: {
          kind: "send-message",
          id: "t1s0",
          message: { type: "text", content: "pong" },
          requestId: "r1",
        },
      },
    });
    expect(text).toEqual([
      {
        _tag: "bot-message",
        agentId,
        entry: {
          kind: "send-message",
          id: "t1s0",
          message: { type: "text", content: "pong" },
          requestId: "r1",
        },
      },
    ]);

    const permission = gatewaySignals({
      channel: "transcript",
      payload: {
        type: "appended",
        agentId,
        entry: {
          kind: "send-message",
          id: "t2s1",
          message: {
            type: "local-tool-permission",
            ask: { requestId: "req", action: "run-command", target: "pbpaste", status: "always" },
          },
        },
      },
    });
    expect(permission).toHaveLength(1);
    expect(permission[0]?._tag === "bot-message" && permission[0].entry.message.type).toBe(
      "local-tool-permission",
    );
  });

  it("ignores user echoes, bookkeeping rows and unknown card types", () => {
    for (const entry of [
      { kind: "message", id: "t0u", role: "user", content: "hi" },
      { kind: "spend-initiation", id: "spend-initiation:1" },
      { kind: "event", id: "e1", event: { type: "name-changed" } },
      { kind: "send-message", id: "t0s2", message: { type: "connector", connector: "Gmail" } },
    ]) {
      expect(
        gatewaySignals({ channel: "transcript", payload: { type: "appended", agentId, entry } }),
      ).toEqual([]);
    }
  });

  it("reads the running flag from roster upserts and snapshots", () => {
    const upserted = gatewaySignals({
      channel: "agent-upserted",
      payload: { activeAgentId: agentId, agent: { id: agentId, isRunningTurn: true } },
    });
    expect(upserted).toEqual([{ _tag: "agent", agent: { id: agentId, isRunningTurn: true } }]);

    const roster = gatewaySignals({
      channel: "agents",
      payload: { agents: [{ id: "a" }, { id: "b", isRunningTurn: false }] },
    });
    expect(roster.map((signal) => signal._tag)).toEqual(["agent", "agent"]);
  });

  it("describes live activity and clears it when the feed sends null", () => {
    expect(
      gatewaySignals({
        channel: "agent-activity",
        payload: {
          agentId,
          live: { activity: { kind: "shell", tool: "bash", detail: "git clone" } },
        },
      }),
    ).toEqual([
      {
        _tag: "activity",
        agentId,
        activity: { kind: "shell", tool: "bash", detail: "git clone" },
      },
    ]);
    expect(gatewaySignals({ channel: "agent-activity", payload: { agentId, live: null } })).toEqual(
      [{ _tag: "activity", agentId, activity: null }],
    );
    expect(describeActivity({ kind: "shell", tool: "bash", detail: "git clone" })).toBe(
      "shell · bash: git clone",
    );
    expect(describeActivity({})).toBe("Working");
  });

  it("drops channels the adapter does not model", () => {
    expect(gatewaySignals({ channel: "box-disk-pressure", payload: null })).toEqual([]);
  });
});
