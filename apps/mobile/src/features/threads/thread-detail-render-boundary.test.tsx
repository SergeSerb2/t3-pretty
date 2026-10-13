// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import {
  EnvironmentId,
  MessageId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ProjectedTurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { Atom, AtomRegistry } from "effect/reactivity";
import {
  act,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

type Listener = (event: { readonly data: { readonly closing: boolean } }) => void;
function makeNavigation(focused = true) {
  const listeners = new Map<string, Set<Listener>>();
  return {
    focused,
    listeners,
    isFocused() {
      return this.focused;
    },
    addListener(type: string, listener: Listener) {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    emit(type: string, closing = false) {
      for (const listener of listeners.get(type) ?? []) listener({ data: { closing } });
    },
  };
}
const harness = vi.hoisted(() => ({
  atomFor: (_threadId: string, _kind: "projection" | "items"): unknown => undefined,
  appState: "active",
  appListeners: new Set<() => void>(),
  nativeRenders: 0,
  nativeParses: 0,
  nativeDocument: "",
  nativeConfigurations: [] as string[],
  nativeChipIds: [] as string[],
  nativePresses: [] as Array<() => void>,
}));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => useContext(Navigation) }));
vi.mock("../../state/threads", () => ({
  environmentThreadDetails: {
    threadAtom: ({ threadId }: { threadId: string }) => harness.atomFor(threadId, "projection"),
    visibleTurnItemsAtom: ({ threadId }: { threadId: string }) =>
      harness.atomFor(threadId, "items"),
  },
  useEnvironmentThread: () => undefined,
}));
vi.mock("../../state/use-thread-selection", () => ({
  useThreadSelection: () => ({ selectedThreadDetailRef: null }),
}));
vi.mock("react-native", () => ({
  Platform: {
    OS: "ios",
    select: (values: { ios?: unknown; default?: unknown }) => values.ios ?? values.default,
  },
  StyleSheet: {
    hairlineWidth: 1,
    create: (value: unknown) => value,
    flatten: (value: unknown) => Object.assign({}, ...[value].flat(Infinity).filter(Boolean)),
  },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  ScrollView: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Pressable: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Image: Object.assign(() => null, { resolveAssetSource: (value: unknown) => value }),
  useColorScheme: () => "light",
  findNodeHandle: () => null,
  Linking: { openURL: () => undefined },
  codegenNativeComponent:
    (name: string) =>
    ({
      children,
      text,
      contextClipboardConfig,
      nativeID,
      onPress,
    }: {
      children?: ReactNode;
      text?: string;
      contextClipboardConfig?: string;
      nativeID?: string;
      onPress?: () => void;
    }) => {
      if (name === "T3MarkdownText") {
        harness.nativeRenders++;
        if (contextClipboardConfig) harness.nativeConfigurations.push(contextClipboardConfig);
      }
      if (nativeID?.startsWith("t3-chip:")) {
        harness.nativeChipIds.push(nativeID);
        if (onPress) harness.nativePresses.push(onPress);
      }
      return <span>{text ?? children}</span>;
    },
  AppState: {
    get currentState() {
      return harness.appState;
    },
    addEventListener: (_type: string, listener: () => void) => {
      harness.appListeners.add(listener);
      return { remove: () => harness.appListeners.delete(listener) };
    },
  },
}));
vi.mock(
  "react-native-nitro-markdown/headless",
  () => import("../../../node_modules/react-native-nitro-markdown/src/headless.ts"),
);
vi.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: () => ({
      // The native boundary supplies one code block or paragraph for this
      // workload. Headless JSON decoding and the owned renderer stay real.
      parseWithOptions: (markdown: string) => {
        harness.nativeParses++;
        if (harness.nativeDocument) return harness.nativeDocument;
        const code = markdown.startsWith("```tsx\n");
        return JSON.stringify({
          type: "document",
          children: [
            code
              ? {
                  type: "code_block",
                  language: "tsx",
                  content: markdown.slice(7),
                  beg: 0,
                  end: markdown.length,
                }
              : {
                  type: "paragraph",
                  beg: 0,
                  end: markdown.length,
                  children: [{ type: "text", content: markdown, beg: 0, end: markdown.length }],
                },
          ],
        });
      },
    }),
  },
}));
vi.mock("expo", () => ({ requireOptionalNativeModule: () => null }));
vi.mock("expo-symbols", () => ({ SymbolView: () => null }));
vi.mock("expo-clipboard", () => ({ setStringAsync: () => Promise.resolve() }));
vi.mock("expo-haptics", () => ({
  impactAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: "light" },
}));
vi.mock("../../../modules/t3-markdown-text/src/markdownFileIcons", () => ({
  markdownFileIconSource: () => null,
  markdownIconAssetUri: () => undefined,
}));
vi.mock("../../../modules/t3-markdown-text/src/markdownLinkIcons", () => ({
  markdownLinkIconSource: () => null,
}));
vi.mock("../../lib/showMarkdownLinkActions", () => ({
  showMarkdownLinkActionSheet: () => undefined,
}));
vi.mock("../review/shikiReviewHighlighter", () => ({
  highlightCodeSnippet: () => Promise.resolve([]),
}));

import { useThreadProjection, useThreadVisibleTurnItems } from "../../state/use-thread-detail";
import { SelectableMarkdownText } from "../../native/SelectableMarkdownText.ios";
import type { NativeMarkdownTextStyle } from "../../native/SelectableMarkdownText.types";
import { useStackRouteVisible } from "../../native/use-stack-route-visible";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";
import * as activity from "../../lib/threadActivity";
import * as contextClipboard from "@t3tools/shared/composerContextClipboard";
import { scopedThreadKey } from "../../lib/scopedEntities";
import { visibleUserMessageIds } from "../../state/acknowledged-thread-messages.logic";
import { useThreadFeedPresentation } from "../../state/use-thread-feed-presentation";
import type { QueuedThreadMessage } from "../../state/thread-outbox-model";
import { ThreadDetailRenderBoundary } from "./thread-detail-render-boundary";

const environmentId = EnvironmentId.make("retained-thread-workload");
const style: NativeMarkdownTextStyle = {
  color: "black",
  strongColor: "black",
  mutedColor: "gray",
  linkColor: "blue",
  inlineCodeColor: "black",
  codeColor: "black",
  codeBackgroundColor: "gray",
  codeBlockBackgroundColor: "gray",
  fileTextColor: "blue",
  skillTextColor: "blue",
  quoteMarkerColor: "gray",
  dividerColor: "gray",
  fontSize: 14,
  lineHeight: 20,
  fontFamily: "sans",
  headingFontFamily: "sans",
  boldFontFamily: "sans",
};
const largeBody = "```tsx\n" + 'const component = <Widget label="example" />;\n'.repeat(2500);
const EMPTY_MESSAGES: readonly QueuedThreadMessage[] = [];
function items(
  id: string,
  update: number,
  body = "Short streamed response ",
): readonly OrchestrationV2ProjectedTurnItem[] {
  const timestamp = DateTime.makeUnsafe("2026-10-13T00:00:00.000Z");
  const threadId = ThreadId.make(id);
  const itemId = TurnItemId.make(`assistant-${id}`);
  return [
    {
      position: 0,
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
        ordinal: 0,
        status: "running",
        title: null,
        startedAt: timestamp,
        completedAt: null,
        updatedAt: timestamp,
        type: "assistant_message",
        messageId: MessageId.make(`message-${id}`),
        text: body + "update " + update,
        streaming: true,
      },
    },
  ];
}
function makeAtoms(id: string, body?: string) {
  const initial = items(id, 0, body);
  return {
    projection: Atom.make({
      environmentId,
      projection: { attempts: [], nodes: [], visibleTurnItems: initial },
    }).pipe(Atom.keepAlive),
    items: Atom.make(initial).pipe(Atom.keepAlive),
  };
}
const fixtures = new Map<string, ReturnType<typeof makeAtoms>>();
const navigations = new Map<string, ReturnType<typeof makeNavigation>>();
const Navigation = createContext<ReturnType<typeof makeNavigation> | null>(null);
const latest = new Map<
  string,
  {
    visible: boolean;
    text: string;
    local: { draft: string; scroll: number; selection: number };
    edit: (value: { draft: string; scroll: number; selection: number }) => void;
  }
>();
const commits = new Map<string, number>();
let unmounts: number;
let registry: AtomRegistry.AtomRegistry;
let root: Root;

function DetailProbe(props: {
  readonly id: string;
  readonly text: string;
  readonly visible: boolean;
}) {
  const [local, edit] = useState({ draft: "", scroll: 0, selection: 0 });
  useEffect(() => {
    latest.set(props.id, { visible: props.visible, text: props.text, local, edit });
    commits.set(props.id, (commits.get(props.id) ?? 0) + 1);
  });
  useEffect(
    () => () => {
      unmounts++;
    },
    [],
  );
  return (
    <SelectableMarkdownText markdown={props.text} textStyle={style} highlightCodeEnabled={false} />
  );
}
function ThreadProbe(props: { readonly id: string }) {
  const visible = useStackRouteVisible();
  const projection = useThreadProjection({ environmentId, threadId: ThreadId.make(props.id) });
  const visibleItems = useThreadVisibleTurnItems({
    environmentId,
    threadId: ThreadId.make(props.id),
  });
  const threadKey = scopedThreadKey(environmentId, ThreadId.make(props.id));
  const echoedMessageIds = useMemo(() => visibleUserMessageIds(visibleItems), [visibleItems]);
  const feed = useThreadFeedPresentation({
    visible,
    threadKey,
    visibleTurnItems: visibleItems,
    echoedMessageIds,
    attempts: projection?.projection.attempts,
    nodes: projection?.projection.nodes,
    pendingCreationMessage: null,
    queuedMessages: EMPTY_MESSAGES,
    acknowledgedMessages: EMPTY_MESSAGES,
  });
  return (
    <ThreadDetailRenderBoundary threadKey={threadKey} visible={visible}>
      {feed.map((entry) =>
        entry.type === "message" ? (
          <DetailProbe key={entry.id} id={props.id} text={entry.message.text} visible={visible} />
        ) : null,
      )}
    </ThreadDetailRenderBoundary>
  );
}
function mount(
  ids: readonly string[],
  input: { readonly focused?: boolean; readonly body?: string; readonly tabActive?: boolean } = {},
) {
  for (const id of ids) {
    fixtures.set(id, makeAtoms(id, input.body));
    navigations.set(id, makeNavigation(input.focused));
  }
  render(ids, input.tabActive ?? true);
}
function render(ids: readonly string[], tabActive = true) {
  act(() =>
    root.render(
      <RegistryContext value={registry}>
        <NativeWorkspaceTabActivityContext value={{ active: tabActive, isActive: () => tabActive }}>
          {ids.map((id) => {
            const navigation = navigations.get(id)!;
            return (
              <Navigation key={id} value={navigation}>
                <ThreadProbe id={id} />
              </Navigation>
            );
          })}
        </NativeWorkspaceTabActivityContext>
      </RegistryContext>,
    ),
  );
}
function transition(
  id: string,
  type: "transitionStart" | "transitionEnd" | "focus" | "blur",
  closing = false,
) {
  act(() => navigations.get(id)!.emit(type, closing));
}
function stream(ids: readonly string[], count: number, body?: string) {
  for (let update = 1; update <= count; update++)
    act(() => {
      for (const id of ids) {
        const value = items(id, update, body);
        const atoms = fixtures.get(id)!;
        registry.set(atoms.projection, {
          environmentId,
          projection: { attempts: [], nodes: [], visibleTurnItems: value },
        });
        registry.set(atoms.items, value);
      }
    });
}
function appState(state: string) {
  act(() => {
    harness.appState = state;
    for (const listener of harness.appListeners) listener();
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  registry = AtomRegistry.make();
  root = createRoot(globalThis.document.createElement("div"));
  fixtures.clear();
  navigations.clear();
  latest.clear();
  commits.clear();
  unmounts = 0;
  harness.appState = "active";
  harness.nativeRenders = 0;
  harness.nativeParses = 0;
  harness.nativeDocument = "";
  harness.nativeConfigurations.length = 0;
  harness.nativeChipIds.length = 0;
  harness.nativePresses.length = 0;
  harness.atomFor = (id, kind) => fixtures.get(id)![kind];
});
afterEach(() => {
  act(() => root.unmount());
  registry.dispose();
  expect(harness.appListeners.size).toBe(0);
  for (const navigation of navigations.values())
    expect([...navigation.listeners.values()].every((set) => set.size === 0)).toBe(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("does not repeat owned-renderer native parser calls and native prop work for three retained hidden streams", async () => {
  const ids = ["active", "hidden-1", "hidden-2", "hidden-3"];
  mount(ids, { body: largeBody });
  await act(async () => undefined);
  for (const id of ids.slice(1)) transition(id, "transitionEnd", true);
  const parsesBefore = harness.nativeParses;
  const builder = vi.spyOn(activity, "buildThreadFeed");
  const before = harness.nativeRenders;
  const beforeCommits = commits.get("active")!;
  stream(ids, 20, largeBody);
  expect(harness.nativeParses - parsesBefore).toBe(20);
  expect(harness.nativeRenders - before).toBe(20);
  expect(builder).toHaveBeenCalledTimes(20);
  expect(commits.get("active")! - beforeCommits).toBe(20);
  expect(latest.get("active")?.text).toContain("update 20");
  expect(latest.get("hidden-1")?.text).toContain("update 0");
  expect(unmounts).toBe(0);
});

it("decodes a large user context once for an owned-renderer table", () => {
  harness.nativeDocument = JSON.stringify({
    type: "document",
    children: [
      {
        type: "table",
        children: Array.from({ length: 10 }, (_, row) => ({
          type: "table_row",
          children: Array.from({ length: 10 }, (_, column) => ({
            type: "table_cell",
            children: [{ type: "text", content: `cell ${row}:${column}` }],
          })),
        })),
      },
    ],
  });
  const fragment = JSON.stringify({
    version: 1,
    source: { environmentId },
    records: Array.from({ length: 16 }, (_, index) => ({
      version: 1,
      contextId: `terminal-${index}`,
      kind: "terminal",
      label: "Terminal",
      terminalId: "terminal",
      terminalLabel: "Terminal",
      lineStart: 0,
      lineEnd: 100,
      text: "x".repeat(64000),
    })),
  });
  expect(contextClipboard.decodeComposerContextFragment(fragment)?.records).toHaveLength(16);
  const decode = vi.spyOn(contextClipboard, "decodeComposerContextFragment");
  const start = performance.now();
  act(() =>
    root.render(
      <SelectableMarkdownText
        markdown="context table"
        textStyle={style}
        contextClipboardFragment={fragment}
        highlightCodeEnabled={false}
      />,
    ),
  );
  const elapsed = performance.now() - start;
  console.info(
    `context table: cells=100 fragmentChars=${fragment.length} decodes=${decode.mock.calls.length} ms=${elapsed.toFixed(2)}`,
  );
  expect(decode).toHaveBeenCalledTimes(1);
});

it("shares current context records while preserving native copy ranges and link actions", () => {
  const href = "t3-context://v1/file/file-0";
  harness.nativeDocument = JSON.stringify({
    type: "document",
    children: [
      {
        type: "paragraph",
        children: [{ type: "link", href, children: [{ type: "text", content: "Attachment" }] }],
      },
    ],
  });
  const fragment = (mimeType?: string) =>
    JSON.stringify({
      version: 1,
      source: { environmentId },
      records: mimeType
        ? [
            {
              version: 1,
              contextId: "file-0",
              kind: "file",
              label: "Attachment",
              attachmentId: "attachment-0",
              name: "attachment.bin",
              mimeType,
              sizeBytes: 10,
            },
          ]
        : [],
    });
  const decode = vi.spyOn(contextClipboard, "decodeComposerContextFragment");
  const open = vi.fn();
  function renderContext(value?: string, textStyle = style) {
    harness.nativeConfigurations.length = 0;
    harness.nativeChipIds.length = 0;
    harness.nativePresses.length = 0;
    act(() =>
      root.render(
        <SelectableMarkdownText
          markdown="context link"
          textStyle={textStyle}
          contextClipboardFragment={value}
          onLinkPress={open}
          highlightCodeEnabled={false}
        />,
      ),
    );
    const config = JSON.parse(harness.nativeConfigurations.at(-1)!);
    expect(config.fragment).toBe(value ?? "");
    expect(config.ranges).toEqual([{ start: 0, end: 1, text: `[Attachment](${href})` }]);
    return JSON.parse(harness.nativeChipIds.at(-1)!.slice("t3-chip:".length));
  }
  const file = fragment("text/plain");
  expect(renderContext(file)).toMatchObject({ accent: "#0090cd", fontSize: expect.closeTo(11.2) });
  expect(renderContext(file, { ...style, fontSize: 20 })).toMatchObject({
    accent: "#0090cd",
    fontSize: 16,
  });
  expect(decode).toHaveBeenCalledTimes(1);
  expect(renderContext(fragment("video/mp4"))).toMatchObject({ accent: "#d06217" });
  expect(decode).toHaveBeenCalledTimes(2);
  expect(renderContext(fragment())).toMatchObject({ accent: "#0090cd" });
  expect(renderContext("{invalid")).toMatchObject({ accent: "#0090cd" });
  expect(renderContext()).toMatchObject({ accent: "#0090cd" });
  expect(decode).toHaveBeenCalledTimes(5);
  act(() => harness.nativePresses.at(-1)!());
  expect(open).toHaveBeenCalledExactlyOnceWith(href);
});

it("keeps the first hide render live, then resumes latest content at interactive reveal start with local state intact", () => {
  mount(["thread"]);
  const local = { draft: "Keep my draft", scroll: 173, selection: 5 };
  act(() => latest.get("thread")!.edit(local));
  transition("thread", "transitionStart", true);
  stream(["thread"], 2);
  expect(latest.get("thread")?.text).toContain("update 2");
  transition("thread", "transitionEnd", true);
  const before = commits.get("thread")!;
  stream(["thread"], 20);
  expect(commits.get("thread")).toBe(before);
  expect(latest.get("thread")?.visible).toBe(false);
  transition("thread", "transitionStart", false);
  expect(latest.get("thread")).toMatchObject({
    visible: true,
    text: "Short streamed response update 20",
    local,
  });
  expect(unmounts).toBe(0);
});

it("pauses again when an interactive reveal is canceled", () => {
  mount(["thread"]);
  transition("thread", "transitionEnd", true);
  stream(["thread"], 4);
  transition("thread", "transitionStart", false);
  expect(latest.get("thread")?.text).toContain("update 4");
  transition("thread", "transitionStart", true);
  transition("thread", "transitionEnd", true);
  const before = commits.get("thread")!;
  stream(["thread"], 6);
  expect(commits.get("thread")).toBe(before);
  expect(latest.get("thread")?.visible).toBe(false);
});

it.each(["Thread", "ThreadFiles"])(
  "keeps a visible %s split-pane detail live while its navigation is not focused",
  (id) => {
    mount([id], { focused: false });
    transition(id, "transitionStart", false);
    navigations.get(id)!.focused = false;
    transition(id, "blur");
    stream([id], 3);
    expect(latest.get(id)).toMatchObject({
      visible: true,
      text: "Short streamed response update 3",
    });
  },
);

it("pauses retained native tabs even without child disappear events and resumes their current snapshot", () => {
  mount(["thread"]);
  render(["thread"], false);
  const before = commits.get("thread")!;
  stream(["thread"], 5);
  expect(commits.get("thread")).toBe(before);
  render(["thread"]);
  expect(latest.get("thread")).toMatchObject({
    visible: true,
    text: "Short streamed response update 5",
  });
});

it("pauses an inactive app and restores only native-visible routes on resume", () => {
  mount(["visible", "covered"]);
  transition("covered", "transitionEnd", true);
  appState("background");
  const before = new Map(commits);
  stream(["visible", "covered"], 5);
  expect(commits).toEqual(before);
  appState("active");
  expect(latest.get("visible")).toMatchObject({
    visible: true,
    text: "Short streamed response update 5",
  });
  expect(latest.get("covered")).toMatchObject({
    visible: false,
    text: "Short streamed response update 0",
  });
});
