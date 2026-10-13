// @vitest-environment jsdom
import {
  CommandId,
  EnvironmentId,
  MessageId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { act, Suspense, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

import { scopedThreadKey } from "../lib/scopedEntities";
import * as activity from "../lib/threadActivity";
import { visibleUserMessageIds } from "./acknowledged-thread-messages.logic";
import type { QueuedThreadMessage } from "./thread-outbox-model";
import { useThreadFeedPresentation } from "./use-thread-feed-presentation";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const environmentId = EnvironmentId.make("feed-environment");
const timestamp = DateTime.makeUnsafe("2026-10-13T00:00:00.000Z");
type Input = Parameters<typeof useThreadFeedPresentation>[0];
type Feed = ReturnType<typeof useThreadFeedPresentation>;
function rows(id: string, count = 1): readonly OrchestrationV2ProjectedTurnItem[] {
  const threadId = ThreadId.make(id);
  return Array.from({ length: count }, (_, index) => {
    const itemId = TurnItemId.make(`${id}-${index}`);
    return {
      position: index,
      visibility: "local",
      sourceThreadId: threadId,
      sourceItemId: itemId,
      item: {
        id: itemId,
        threadId,
        runId: RunId.make(`run-${id}`),
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal: index,
        status: "running",
        title: null,
        startedAt: timestamp,
        completedAt: null,
        updatedAt: timestamp,
        type: "assistant_message",
        messageId: MessageId.make(`message-${id}-${index}`),
        text: `response ${index}`,
        streaming: true,
      },
    };
  });
}
function updateTail(current: Input["visibleTurnItems"], text: string): Input["visibleTurnItems"] {
  const tail = current.at(-1)!;
  if (tail.item.type !== "assistant_message") throw new Error("Expected assistant tail");
  return [...current.slice(0, -1), { ...tail, item: { ...tail.item, text } }];
}
function input(id = "thread", count = 1): Input {
  const visibleTurnItems = rows(id, count);
  return {
    visible: true,
    threadKey: scopedThreadKey(environmentId, ThreadId.make(id)),
    visibleTurnItems,
    echoedMessageIds: visibleUserMessageIds(visibleTurnItems),
    attempts: undefined,
    nodes: undefined,
    pendingCreationMessage: null,
    queuedMessages: [],
    acknowledgedMessages: [],
  };
}
function pending(id: string, text: string): QueuedThreadMessage {
  return {
    environmentId,
    threadId: ThreadId.make("thread"),
    commandId: CommandId.make(`command-${id}`),
    messageId: MessageId.make(id),
    text,
    attachments: [],
    createdAt: "2026-10-13T00:00:00.000Z",
  };
}
function delivered(message: QueuedThreadMessage): OrchestrationV2ProjectedTurnItem {
  const template = rows("thread")[0]!;
  if (template.item.type !== "assistant_message") throw new Error("Expected assistant template");
  return {
    ...template,
    item: {
      ...template.item,
      type: "user_message",
      messageId: message.messageId,
      text: message.text,
      attachments: [],
      createdBy: "user",
      creationSource: "mobile",
      inputIntent: "turn_start",
    },
  };
}

const latest = new Map<string, { feed: Feed; draft: string; setDraft: (value: string) => void }>();
let mounts = 0;
let unmounts = 0;
function Screen({ id, input }: { id: string; input: Input }) {
  const [draft, setDraft] = useState("");
  const echoedMessageIds = useMemo(
    () => visibleUserMessageIds(input.visibleTurnItems),
    [input.visibleTurnItems],
  );
  const feed = useThreadFeedPresentation({ ...input, echoedMessageIds });
  latest.set(id, { feed, draft, setDraft });
  useEffect(() => {
    mounts++;
    return () => void unmounts++;
  }, []);
  return null;
}
let root: Root | undefined;
let container: HTMLDivElement | undefined;
function render(inputs: ReadonlyArray<Input>) {
  if (!root) {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  }
  act(() =>
    root!.render(
      inputs.map((input, index) => (
        // oxlint-disable-next-line react/no-array-index-key -- Route slots must retain their state through a thread-key replacement.
        <Screen key={`route-${index}`} id={String(index)} input={input} />
      )),
    ),
  );
}
afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  latest.clear();
  mounts = 0;
  unmounts = 0;
  vi.restoreAllMocks();
});

it("skips actual large-history feed work for retained hidden routes and reveals the latest feed", () => {
  const build = vi.spyOn(activity, "buildThreadFeed");
  let inputs = Array.from({ length: 4 }, (_, index) => input(`thread-${index}`, 10_000));
  render(inputs);
  const committed = inputs.map((_, index) => latest.get(String(index))!.feed);
  act(() => latest.get("1")!.setDraft("Keep my draft"));
  inputs = inputs.map((entry, index) => ({ ...entry, visible: index === 0 }));
  render(inputs);
  build.mockClear();
  for (let update = 1; update <= 20; update++) {
    inputs = inputs.map((entry) => ({
      ...entry,
      visibleTurnItems: updateTail(entry.visibleTurnItems, `latest update ${update}`),
    }));
    render(inputs);
  }
  expect(build).toHaveBeenCalledTimes(20);
  for (let index = 1; index < 4; index++)
    expect(latest.get(String(index))!.feed).toBe(committed[index]);
  expect(latest.get("1")!.draft).toBe("Keep my draft");
  expect({ mounts, unmounts }).toEqual({ mounts: 4, unmounts: 0 });

  inputs = inputs.map((entry, index) => (index === 1 ? { ...entry, visible: true } : entry));
  render(inputs);
  expect(build).toHaveBeenCalledTimes(21);
  expect(latest.get("1")!.feed.at(-1)).toMatchObject({
    type: "message",
    message: { text: "latest update 20" },
  });
  expect(latest.get("1")!.draft).toBe("Keep my draft");
});

it("keeps visible output unchanged and does not rebuild stable visible inputs", () => {
  const initial = input();
  const expected = activity.buildThreadFeed(initial.visibleTurnItems);
  const build = vi.spyOn(activity, "buildThreadFeed");
  render([initial]);
  expect(latest.get("0")!.feed).toEqual(expected);
  act(() => latest.get("0")!.setDraft("Local edit"));
  render([initial]);
  expect(build).toHaveBeenCalledTimes(1);
});

it("does not retain presentation from an abandoned visible render", () => {
  const waiting = new Promise<never>(() => {});
  let committed: Feed = [];
  function SuspendableScreen({ input, suspend }: { input: Input; suspend: boolean }) {
    const feed = useThreadFeedPresentation(input);
    useLayoutEffect(() => {
      committed = feed;
    }, [feed]);
    if (suspend) throw waiting;
    return null;
  }
  render([]);
  const draw = (input: Input, suspend = false) =>
    act(() =>
      root!.render(
        <Suspense fallback={null}>
          <SuspendableScreen input={input} suspend={suspend} />
        </Suspense>,
      ),
    );
  const initial = input();
  draw(initial);
  const held = committed;
  const next = {
    ...initial,
    visibleTurnItems: updateTail(initial.visibleTurnItems, "Never committed"),
  };
  draw(next, true);
  draw({ ...next, visible: false });
  expect(committed).toBe(held);
  draw(next);
  expect(committed.at(-1)).toMatchObject({ type: "message", message: { text: "Never committed" } });
});

it("uses empty presentation for initially hidden or replaced thread identities", () => {
  const build = vi.spyOn(activity, "buildThreadFeed");
  const first = input("thread");
  render([{ ...first, visible: false }]);
  expect(latest.get("0")!.feed).toEqual([]);
  expect(build).not.toHaveBeenCalled();
  render([first]);
  expect(build).toHaveBeenCalledTimes(1);
  const otherEnvironment = {
    ...first,
    visible: false,
    threadKey: scopedThreadKey(EnvironmentId.make("other-environment"), ThreadId.make("thread")),
  };
  render([otherEnvironment]);
  expect(latest.get("0")!.feed).toEqual([]);
  render([{ ...otherEnvironment, threadKey: input("other-thread").threadKey }]);
  expect(latest.get("0")!.feed).toEqual([]);
  render([{ ...otherEnvironment, visible: true }]);
  expect(build).toHaveBeenCalledTimes(2);
  expect({ mounts, unmounts }).toEqual({ mounts: 1, unmounts: 0 });
});

it("applies the latest creation echo and acknowledgment/outbox state on reveal", () => {
  const creation = pending("creation", "Create my thread");
  let current: Input = { ...input(), visibleTurnItems: [], pendingCreationMessage: creation };
  render([current]);
  expect(latest.get("0")!.feed).toMatchObject([
    { type: "message", message: { id: creation.messageId } },
  ]);
  const held = latest.get("0")!.feed;
  const acknowledged = pending("acknowledged", "Sent while hidden");
  const queued = pending("queued", "Still in the outbox");
  const otherEnvironment = {
    ...pending("remote", "Other environment"),
    environmentId: EnvironmentId.make("remote"),
  };
  current = {
    ...current,
    visible: false,
    visibleTurnItems: [delivered(creation)],
    queuedMessages: [queued],
    acknowledgedMessages: [acknowledged, queued, otherEnvironment],
  };
  render([current]);
  expect(latest.get("0")!.feed).toBe(held);
  render([{ ...current, visible: true }]);
  const feed = latest.get("0")!.feed;
  expect(feed).toHaveLength(2);
  expect(feed[0]).toMatchObject({ type: "message", message: { id: creation.messageId } });
  expect(feed[0]?.pendingMessage).toBeUndefined();
  expect(feed[1]).toMatchObject({
    type: "message",
    message: { id: acknowledged.messageId, text: acknowledged.text },
    pendingMessage: acknowledged,
    acknowledged: true,
  });
});
