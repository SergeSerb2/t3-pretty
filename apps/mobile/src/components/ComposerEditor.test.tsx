// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Alert } from "react-native";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type { ComposerEditorProps as NativeEditorProps } from "../native/T3ComposerEditor.types";
import type { importComposerContextClipboard } from "../lib/composerContextClipboard";

const harness = vi.hoisted(() => ({
  nativeProps: null as NativeEditorProps | null,
  importContext: vi.fn<typeof importComposerContextClipboard>(),
  insertText: vi.fn(),
  insertContext: vi.fn(() => true),
  importing: new Map<string, boolean>(),
  cleanupAttachments: vi.fn(),
}));
vi.mock("../native/T3ComposerEditor", () => ({
  ComposerEditor: (props: NativeEditorProps) => {
    harness.nativeProps = props;
    return <textarea readOnly={props.readOnly} defaultValue={props.value} />;
  },
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => ({ _tag: "Initial" }) }));
vi.mock("@react-navigation/native", () => ({ useNavigation: () => ({ navigate: vi.fn() }) }));
vi.mock("react-native", () => ({ Alert: { alert: vi.fn() } }));
vi.mock("../state/preferences", () => ({ mobilePreferencesAtom: {} }));
vi.mock("./AppText", () => ({ AppText: "span" }));
vi.mock("./ComposerContextSheet", () => ({ ComposerContextSheet: () => null }));
vi.mock("../lib/composerContext", () => ({
  composerMentionPath: () => null,
  composerDocumentAttachment: () => null,
}));
vi.mock("../lib/composerContextClipboard", () => ({
  importComposerContextClipboard: harness.importContext,
}));
vi.mock("../state/use-composer-drafts", () => {
  const draft = { text: "draft", attachments: [], context: undefined };
  return {
    useComposerDraft: () => draft,
    getComposerDraftSnapshot: () => draft,
    getComposerDraftAfterSelection: () => draft,
    createComposerDraftContextHistory: () => ({ dispose: vi.fn(), restore: () => draft }),
    appendComposerDraftAttachments: vi.fn(),
    insertComposerDraftContext: harness.insertContext,
    insertComposerDraftText: harness.insertText,
    rememberComposerDraftSelection: vi.fn(),
    setComposerDraftContext: vi.fn(),
    setComposerContextImporting: (key: string, importing: boolean) =>
      harness.importing.set(key, importing),
    scheduleUnusedComposerAttachmentCleanup: harness.cleanupAttachments,
  };
});

import { ComposerEditor } from "./ComposerEditor";

type ImportResult = Awaited<ReturnType<typeof importComposerContextClipboard>>;
function pendingImport() {
  let resolve!: (result: ImportResult) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<ImportResult>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  harness.importContext.mockReturnValueOnce(promise);
  return { resolve, reject, promise };
}

let root: Root;
let container: HTMLDivElement;
function render(draftKey: string) {
  act(() =>
    root.render(<ComposerEditor draftKey={draftKey} value="draft" onChangeText={() => {}} />),
  );
}
function paste() {
  act(() =>
    harness.nativeProps?.onPasteContext?.({
      value: "draft",
      text: "pasted context",
      eventCount: 1,
      selection: { start: 5, end: 5 },
      fragment: "context-fragment",
      html: "",
    }),
  );
}
function readOnly() {
  return container.querySelector("textarea")?.readOnly;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  harness.nativeProps = null;
  harness.importContext.mockReset();
  harness.insertText.mockClear();
  harness.insertContext.mockClear();
  harness.importing.clear();
  harness.cleanupAttachments.mockClear();
  vi.mocked(Alert.alert).mockClear();
  container = document.createElement("div");
  root = createRoot(container);
  render("draft-a");
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it("releases the old draft and allows another paste before its cancelled import settles", async () => {
  const first = pendingImport();
  paste();
  const signal = harness.importContext.mock.calls[0]?.[2];
  expect(readOnly()).toBe(true);
  expect(harness.importing.get("draft-a")).toBe(true);

  render("draft-b");
  expect(signal?.aborted).toBe(true);
  expect(readOnly()).toBe(false);
  expect(harness.importing.get("draft-a")).toBe(false);

  const second = pendingImport();
  paste();
  expect(harness.importContext).toHaveBeenCalledTimes(2);
  expect(readOnly()).toBe(true);

  await act(async () => first.resolve(null));
  expect(harness.insertText).not.toHaveBeenCalled();
  expect(readOnly()).toBe(true);
  expect(harness.importing.get("draft-b")).toBe(true);

  await act(async () => second.resolve(null));
  expect(harness.insertText).toHaveBeenCalledWith("draft-b", "pasted context", {
    text: "draft",
    start: 5,
    end: 5,
  });
  expect(readOnly()).toBe(false);
  expect(harness.importing.get("draft-b")).toBe(false);
});

it("does not insert a completed import after the editor unmounts", async () => {
  const pending = pendingImport();
  paste();
  act(() => root.unmount());
  expect(harness.importing.get("draft-a")).toBe(false);
  const result = {
    text: "context",
    context: { version: 1 as const, records: [] },
    attachments: [],
    failures: [],
  };
  await act(async () => pending.resolve(result));
  expect(harness.insertContext).not.toHaveBeenCalled();
  expect(harness.cleanupAttachments).toHaveBeenCalledWith(result.attachments);
});

it("does not unlock a new import when an older import for the same draft settles", async () => {
  const first = pendingImport();
  paste();
  render("draft-b");
  render("draft-a");
  const second = pendingImport();
  paste();
  expect(harness.importContext).toHaveBeenCalledTimes(2);

  await act(async () => first.resolve(null));
  expect(readOnly()).toBe(true);
  expect(harness.importing.get("draft-a")).toBe(true);

  await act(async () => second.resolve(null));
  expect(readOnly()).toBe(false);
});

it("does not alert when a draft change cancels an import that rejects with AbortError", async () => {
  const pending = pendingImport();
  paste();
  const signal = harness.importContext.mock.calls[0]?.[2];

  render("draft-b");
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.reject(new DOMException("Import aborted", "AbortError")));

  expect(Alert.alert).not.toHaveBeenCalled();
  expect(harness.insertText).not.toHaveBeenCalled();
  expect(harness.insertContext).not.toHaveBeenCalled();
  expect(harness.importing.get("draft-a")).toBe(false);
  expect(readOnly()).toBe(false);
});

it("does not alert when unmount cancels an import that rejects with AbortError", async () => {
  const pending = pendingImport();
  paste();
  const signal = harness.importContext.mock.calls[0]?.[2];

  act(() => root.unmount());
  expect(signal?.aborted).toBe(true);
  await act(async () => pending.reject(new DOMException("Import aborted", "AbortError")));

  expect(Alert.alert).not.toHaveBeenCalled();
  expect(harness.insertText).not.toHaveBeenCalled();
  expect(harness.insertContext).not.toHaveBeenCalled();
  expect(harness.importing.get("draft-a")).toBe(false);
});

it("alerts for a failed active import and releases the draft", async () => {
  const pending = pendingImport();
  paste();
  await act(async () => pending.reject(new Error("Source disconnected")));

  expect(Alert.alert).toHaveBeenCalledExactlyOnceWith(
    "Could not paste context",
    "Source disconnected",
  );
  expect(harness.insertText).not.toHaveBeenCalled();
  expect(harness.insertContext).not.toHaveBeenCalled();
  expect(harness.importing.get("draft-a")).toBe(false);
  expect(readOnly()).toBe(false);
});
