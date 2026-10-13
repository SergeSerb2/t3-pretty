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
import { unified } from "unified";
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
  nativeMarkdown: "",
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
  Platform: { OS: "ios" },
  StyleSheet: { hairlineWidth: 1 },
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ActionSheetIOS: {},
  Share: {},
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
vi.mock("react-native-enriched-markdown", () => ({
  EnrichedMarkdownText: ({ markdown }: { readonly markdown: string }) => {
    harness.nativeRenders++;
    harness.nativeMarkdown = markdown;
    return null;
  },
}));
vi.mock("../settings/appearance/AppearancePreferencesProvider", () => ({
  useAppearancePreferences: () => ({ themeAppearance: "light" }),
}));
vi.mock("../../components/AndroidAnchoredMenu", () => ({ AndroidAnchoredMenu: () => null }));
vi.mock("../../native/useEnrichedLinkVariants", () => ({
  useEnrichedLinkVariants: () => ({ linkVariants: {}, linkPillContent: {} }),
}));
vi.mock("../../lib/copyTextWithHaptic", () => ({ copyTextWithHaptic: () => undefined }));

import { useThreadProjection, useThreadVisibleTurnItems } from "../../state/use-thread-detail";
import { MobileEnrichedMarkdownText } from "../../native/EnrichedMarkdownText";
import type { NativeMarkdownTextStyle } from "../../native/SelectableMarkdownText.types";
import { useStackRouteVisible } from "../../native/use-stack-route-visible";
import { NativeWorkspaceTabActivityContext } from "../../native/v5-workspace-context";
import * as document from "../../lib/markdownDocument";
import * as activity from "../../lib/threadActivity";
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
const largeBody =
  "```tsx\n" + 'const component = <Widget label="example" />;\n'.repeat(2500) + "```\n";
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
  return <MobileEnrichedMarkdownText markdown={props.text} textStyle={style} />;
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

it("does not repeat real Markdown parsing and native prop work for three retained hidden streams", () => {
  const ids = ["active", "hidden-1", "hidden-2", "hidden-3"];
  mount(ids, { body: largeBody });
  for (const id of ids.slice(1)) transition(id, "transitionEnd", true);
  const parser = vi.spyOn(document, "markdownWithHtml");
  const builder = vi.spyOn(activity, "buildThreadFeed");
  const before = harness.nativeRenders;
  const beforeCommits = commits.get("active")!;
  stream(ids, 20, largeBody);
  expect(parser).toHaveBeenCalledTimes(20);
  expect(harness.nativeRenders - before).toBe(20);
  expect(builder).toHaveBeenCalledTimes(20);
  expect(commits.get("active")! - beforeCommits).toBe(20);
  expect(latest.get("active")?.text).toContain("update 20");
  expect(latest.get("hidden-1")?.text).toContain("update 0");
  expect(unmounts).toBe(0);
});

it("does not build a redundant JavaScript Markdown AST for a large visible TSX stream", () => {
  mount(["visible"], { body: largeBody });
  const processor = Object.getPrototypeOf(unified()) as ReturnType<typeof unified>;
  const astParser = vi.spyOn(processor, "parse");
  stream(["visible"], 20, largeBody);
  expect(astParser.mock.calls.length).toBe(0);
  expect(harness.nativeMarkdown).toBe(largeBody + "update 20");
});

it.each([
  { name: "backtick fence", body: '```tsx\n<img src="literal.png">\n```\n', parse: false },
  {
    name: "tilde fence with a longer closing",
    body: '~~~tsx\n<img src="literal.png">\n~~~~\n',
    parse: false,
  },
  {
    name: "multiline CRLF code",
    body: 'Before\r\n\r\n```tsx\r\n<img\r\n src="literal.png">\r\n```\r\n',
    parse: false,
  },
  { name: "incomplete streaming fence", body: '```tsx\n<img src="literal.png">\n', parse: false },
  {
    name: "shorter closing stays in code",
    body: '````tsx\n<img src="literal.png">\n```\n<img src="still-code.png">\n',
    parse: false,
  },
  {
    name: "mismatched closing stays in code",
    body: '```tsx\n<img src="literal.png">\n~~~\n<img src="still-code.png">\n',
    parse: false,
  },
  {
    name: "HTML-like code fence info",
    body: "```tsx <Widget>\nconst value = 1;\n```\n",
    parse: false,
  },
  {
    name: "HTML after a longer closing",
    body: '```tsx\n<img src="literal.png">\n````\n\n<img src="outside.png">\n',
    parse: true,
    converted: "outside.png",
  },
  {
    name: "three-space closing exposes HTML",
    body: '```tsx\n<img src="literal.png">\n   ```\n\n<img src="outside.png">\n',
    parse: true,
    converted: "outside.png",
  },
  {
    name: "indented opening fence",
    body: '  ```tsx\n  <img src="literal.png">\n  ```\n',
    parse: true,
  },
  { name: "blockquote fence", body: '> ```tsx\n> <img src="literal.png">\n> ```\n', parse: true },
  {
    name: "list nested fence",
    body: '- Example\n\n  ```tsx\n  <img src="literal.png">\n  ```\n',
    parse: true,
  },
  {
    name: "reference destination resembles a fence",
    body: '[ref]:\n```tsx\n\n<img src="outside.png">\n',
    parse: true,
  },
  {
    name: "reference title contains a fence line",
    body: '[ref]: /foo "title\n```tsx\nend"\n\n<img src="outside.png">\n',
    parse: true,
  },
  {
    name: "invalid backtick info",
    body: '```tsx `bad`\n<img src="outside.png">\n',
    parse: true,
    converted: "outside.png",
  },
  { name: "inline code", body: 'Use `<img src="literal.png">` here.\n', parse: true },
  {
    name: "reference before real HTML",
    body: '[ref]: /foo\n\n```tsx\n<img src="literal.png">\n```\n\n<img src="outside.png">\n',
    parse: true,
    converted: "outside.png",
  },
  {
    name: "multiline real HTML",
    body: '```tsx\nconst value = 1;\n```\n\n<img\n src="outside.png">\n',
    parse: true,
    converted: "outside.png",
  },
  {
    name: "control prefix before a fence",
    body: '\u0000```tsx\n<img src="outside.png">\n',
    parse: true,
    converted: "outside.png",
  },
])(
  "preserves native Markdown output and parser fallback for $name",
  ({ body, parse, converted }) => {
    const processor = Object.getPrototypeOf(unified()) as ReturnType<typeof unified>;
    const astParser = vi.spyOn(processor, "parse");
    mount(["visible"], { body });
    if (parse) expect(astParser).toHaveBeenCalledTimes(1);
    else expect(astParser.mock.calls.length).toBe(0);
    if (converted) {
      expect(harness.nativeMarkdown).toContain(`![](<${converted}>)`);
      expect(harness.nativeMarkdown).not.toContain(`<img src="${converted}">`);
    } else expect(harness.nativeMarkdown).toBe(body + "update 0");
  },
);

it("falls back for BOM/control normalization before deciding whether HTML is inside a fence", () => {
  const processor = Object.getPrototypeOf(unified()) as ReturnType<typeof unified>;
  const astParser = vi.spyOn(processor, "parse");
  const body = "\ufeff```\n~~~~\n[ref]:\n```tsx\n```\n> prose\n</details>\n```\r";
  mount(["visible"], { body });
  expect(astParser).toHaveBeenCalledTimes(1);
  expect(harness.nativeMarkdown).not.toContain("</details>");
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
