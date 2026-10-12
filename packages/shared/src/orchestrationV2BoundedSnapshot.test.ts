import {
  MessageId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2ThreadProjection,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  boundedSnapshotProjection,
  ensureVisibleTurnItems,
  omitLocalVisibleTurnItems,
  restoreLocalVisibleTurnItems,
  retainVisibleTimeline,
} from "./orchestrationV2BoundedSnapshot.ts";

const PARENT = ThreadId.make("thread:compact-parent");
const CHILD = ThreadId.make("thread:compact-child");
const RUN = RunId.make("run:compact");

function item(
  threadId: ThreadId,
  id: string,
  ordinal: number,
  type: "command_execution" | "run_interrupt_request" | "fork" = "command_execution",
): OrchestrationV2TurnItem {
  return {
    id: TurnItemId.make(id),
    type,
    threadId,
    runId: type === "command_execution" ? null : RUN,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed",
    title: id,
    input: id,
    exitCode: 0,
    startedAt: null,
    completedAt: null,
    updatedAt: "2026-10-01T00:00:00.000Z",
  } as unknown as OrchestrationV2TurnItem;
}

function row(
  visibility: OrchestrationV2ProjectedTurnItem["visibility"],
  sourceThreadId: ThreadId,
  value: OrchestrationV2TurnItem,
): Omit<OrchestrationV2ProjectedTurnItem, "position"> {
  return { visibility, sourceThreadId, sourceItemId: value.id, item: value };
}

function projection(input: {
  readonly visible: ReadonlyArray<Omit<OrchestrationV2ProjectedTurnItem, "position">>;
  readonly turnItems: ReadonlyArray<OrchestrationV2TurnItem>;
}): OrchestrationV2ThreadProjection {
  return {
    thread: { id: CHILD },
    turnItems: [...input.turnItems],
    visibleTurnItems: input.visible.map((value, position) => ({ ...value, position })),
  } as unknown as OrchestrationV2ThreadProjection;
}

/** Fork child: inherited parent rows, synthetic marker, local rows, retained interrupt request. */
function forkWindow() {
  const inherited = [item(PARENT, "parent-1", 1), item(PARENT, "parent-2", 2)];
  const marker = item(PARENT, "fork-marker", 3, "fork");
  const local = [item(CHILD, "child-1", 1), item(CHILD, "child-2", 2), item(CHILD, "child-3", 3)];
  const retainedRequest = item(CHILD, "interrupt-request", 0, "run_interrupt_request");
  return {
    local,
    retainedRequest,
    projection: projection({
      visible: [
        ...inherited.map((value) => row("inherited", PARENT, value)),
        row("synthetic", PARENT, marker),
        ...local.map((value) => row("local", CHILD, value)),
      ],
      turnItems: [...local, retainedRequest],
    }),
  };
}

describe("compact bounded snapshot turnItems", () => {
  it("omits only local visible items and restores the exact list and order", () => {
    const { projection: full, local, retainedRequest } = forkWindow();
    const compact = omitLocalVisibleTurnItems(full);

    expect(compact).not.toBeNull();
    // Inherited and synthetic rows never had turnItems; the retained request stays.
    expect(compact!.turnItems).toEqual([retainedRequest]);
    expect(compact!.visibleTurnItems).toBe(full.visibleTurnItems);

    const restored = restoreLocalVisibleTurnItems(compact!);
    expect(restored.turnItems).toEqual([...local, retainedRequest]);
    expect(restored).toEqual(full);
  });

  it("round-trips through JSON as a separately decoded client would see it", () => {
    const { projection: full } = forkWindow();
    const wire = JSON.parse(JSON.stringify(omitLocalVisibleTurnItems(full)));
    expect(
      boundedSnapshotProjection({ projection: wire, turnItemsOmitLocalVisible: true }),
    ).toEqual(JSON.parse(JSON.stringify(full)));
  });

  it("treats rows sourced from the thread itself as local", () => {
    const own = item(CHILD, "own", 1);
    const full = projection({ visible: [row("inherited", CHILD, own)], turnItems: [own] });
    const compact = omitLocalVisibleTurnItems(full);
    expect(compact?.turnItems).toEqual([]);
    expect(restoreLocalVisibleTurnItems(compact!)).toEqual(full);
  });

  it("refuses shapes it cannot restore exactly", () => {
    const [first, second] = [item(CHILD, "a", 1), item(CHILD, "b", 2)];
    const visible = [row("local", CHILD, first), row("local", CHILD, second)];
    // Different order than the visible rows.
    expect(omitLocalVisibleTurnItems(projection({ visible, turnItems: [second, first] }))).toBe(
      null,
    );
    // Equal content but a different object: restoring would not be provably exact.
    expect(
      omitLocalVisibleTurnItems(projection({ visible, turnItems: [{ ...first }, second] })),
    ).toBe(null);
    // A local row without its turn item.
    expect(omitLocalVisibleTurnItems(projection({ visible, turnItems: [first] }))).toBe(null);
  });

  it("sends nothing compact when no local rows are visible", () => {
    const inherited = item(PARENT, "parent", 1);
    const request = item(CHILD, "interrupt-request", 0, "run_interrupt_request");
    expect(
      omitLocalVisibleTurnItems(
        projection({ visible: [row("inherited", PARENT, inherited)], turnItems: [request] }),
      ),
    ).toBe(null);
  });

  it("leaves unmarked snapshots untouched", () => {
    const { projection: full } = forkWindow();
    expect(boundedSnapshotProjection({ projection: full })).toBe(full);
  });
});

describe("tolerant visible timeline restore", () => {
  it("rebuilds visible rows from turnItems when the window is empty", () => {
    const local = item(CHILD, "child-1", 1);
    const next = ensureVisibleTurnItems(
      projection({ visible: [], turnItems: [local] }) as OrchestrationV2ThreadProjection,
    );
    expect(next.visibleTurnItems).toHaveLength(1);
    expect(next.visibleTurnItems[0]?.item).toEqual(local);
  });

  it("rebuilds visible rows from conversation messages when turnItems are empty", () => {
    const occurredAt = DateTime.makeUnsafe("2026-10-09T22:21:00.000Z");
    const message = {
      id: MessageId.make("message-1"),
      threadId: CHILD,
      runId: null,
      nodeId: null,
      role: "user" as const,
      text: "Open Stremio on the Tesla",
      attachments: [],
      streaming: false,
      createdBy: "user" as const,
      creationSource: "web" as const,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    };
    const empty = projection({ visible: [], turnItems: [] }) as OrchestrationV2ThreadProjection;
    const next = ensureVisibleTurnItems({ ...empty, messages: [message] });
    expect(next.visibleTurnItems).toHaveLength(1);
    expect(next.visibleTurnItems[0]?.item).toMatchObject({
      type: "user_message",
      text: "Open Stremio on the Tesla",
    });
  });

  it("accepts ISO string timestamps from an older JSON payload", () => {
    const empty = projection({ visible: [], turnItems: [] }) as OrchestrationV2ThreadProjection;
    const next = ensureVisibleTurnItems({
      ...empty,
      messages: [
        {
          id: MessageId.make("message-iso"),
          threadId: CHILD,
          runId: null,
          nodeId: null,
          role: "assistant",
          text: "Ready on the Tesla",
          attachments: [],
          streaming: false,
          createdBy: "assistant",
          creationSource: "web",
          createdAt: "2026-10-09T22:21:00.000Z",
          updatedAt: "2026-10-09T22:21:01.000Z",
        },
      ],
    } as unknown as OrchestrationV2ThreadProjection);
    expect(next.visibleTurnItems).toHaveLength(1);
    expect(next.visibleTurnItems[0]?.item).toMatchObject({
      type: "assistant_message",
      text: "Ready on the Tesla",
    });
  });

  it("retains a painted same-thread window when a later snapshot is empty", () => {
    const local = item(CHILD, "child-1", 1);
    const previous = ensureVisibleTurnItems(projection({ visible: [], turnItems: [local] }));
    const incoming = projection({ visible: [], turnItems: [] }) as OrchestrationV2ThreadProjection;
    const retained = retainVisibleTimeline(previous, incoming);
    expect(retained.visibleTurnItems).toEqual(previous.visibleTurnItems);
    expect(
      retainVisibleTimeline(previous, incoming, { resetHistory: true }).visibleTurnItems,
    ).toEqual([]);
  });

  it("does not retain a painted window for a different thread", () => {
    const previous = ensureVisibleTurnItems(
      projection({ visible: [], turnItems: [item(CHILD, "child-1", 1)] }),
    );
    const incoming = {
      ...projection({ visible: [], turnItems: [] }),
      thread: { id: PARENT },
    } as unknown as OrchestrationV2ThreadProjection;
    expect(retainVisibleTimeline(previous, incoming).visibleTurnItems).toEqual([]);
  });
});
