import { Schema } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  ConfiguredLocalServerUrls,
  CONFIGURED_LOCAL_SERVER_URLS_MAX_ITEMS,
  DISCOVERED_LOCAL_SERVERS_MAX_ITEMS,
  DiscoveredLocalServer,
  DiscoveredLocalServerList,
  PREVIEW_SESSIONS_MAX_PER_THREAD,
  PREVIEW_URL_MAX_LENGTH,
  PreviewEvent,
  PreviewListResult,
  PreviewNavStatus,
  PreviewSessionSnapshot,
  PreviewViewportSetting,
} from "./preview.ts";
import {
  PREVIEW_AUTOMATION_KEY_MAX_LENGTH,
  PREVIEW_AUTOMATION_ACCESSIBILITY_TREE_MAX_NODES,
  PREVIEW_AUTOMATION_INTERACTIVE_ELEMENTS_MAX_ITEMS,
  PREVIEW_AUTOMATION_OPERATIONS,
  PREVIEW_AUTOMATION_PAGE_TITLE_MAX_LENGTH,
  PREVIEW_AUTOMATION_REQUEST_ID_MAX_LENGTH,
  PREVIEW_AUTOMATION_SELECTOR_MAX_LENGTH,
  PREVIEW_AUTOMATION_TYPE_TEXT_MAX_LENGTH,
  PREVIEW_AUTOMATION_WAIT_TEXT_MAX_LENGTH,
  PREVIEW_AUTOMATION_VISIBLE_TEXT_MAX_LENGTH,
  PreviewAutomationClickInput,
  PreviewAutomationHost,
  PreviewAutomationError,
  PreviewAutomationNavigateInput,
  PreviewAutomationOpenInput,
  PreviewAutomationPressInput,
  PreviewAutomationRequest,
  PreviewAutomationResizeInput,
  PreviewAutomationResizeResult,
  PreviewAutomationStatus,
  PreviewAutomationSnapshot,
  PreviewAutomationTypeInput,
  PreviewAutomationWaitForInput,
} from "./previewAutomation.ts";

const decodePreviewEvent = Schema.decodeUnknownSync(PreviewEvent);
const decodeSnapshot = Schema.decodeUnknownSync(PreviewSessionSnapshot);
const decodeNavStatus = Schema.decodeUnknownSync(PreviewNavStatus);
const decodeServer = Schema.decodeUnknownSync(DiscoveredLocalServer);
const decodeConfiguredLocalServerUrls = Schema.decodeUnknownSync(ConfiguredLocalServerUrls);
const decodeDiscoveredLocalServerList = Schema.decodeUnknownSync(DiscoveredLocalServerList);
const decodePreviewList = Schema.decodeUnknownSync(PreviewListResult);
const decodeViewport = Schema.decodeUnknownSync(PreviewViewportSetting);
const decodeResizeInput = Schema.decodeUnknownSync(PreviewAutomationResizeInput);
const decodeOpenInput = Schema.decodeUnknownSync(PreviewAutomationOpenInput);
const decodeResizeResult = Schema.decodeUnknownSync(PreviewAutomationResizeResult);
const decodeAutomationHost = Schema.decodeUnknownSync(PreviewAutomationHost);
const decodeAutomationError = Schema.decodeUnknownSync(PreviewAutomationError);
const decodeAutomationStatus = Schema.decodeUnknownSync(PreviewAutomationStatus);
const decodeAutomationSnapshot = Schema.decodeUnknownSync(PreviewAutomationSnapshot);
const decodeAutomationClick = Schema.decodeUnknownSync(PreviewAutomationClickInput);
const decodeAutomationNavigate = Schema.decodeUnknownSync(PreviewAutomationNavigateInput);
const decodeAutomationPress = Schema.decodeUnknownSync(PreviewAutomationPressInput);
const decodeAutomationRequest = Schema.decodeUnknownSync(PreviewAutomationRequest);
const decodeAutomationType = Schema.decodeUnknownSync(PreviewAutomationTypeInput);
const decodeAutomationWaitFor = Schema.decodeUnknownSync(PreviewAutomationWaitForInput);

describe("PreviewAutomationOpenInput", () => {
  it("accepts the inline preview visibility flag", () => {
    expect(decodeOpenInput({ open: false })).toEqual({ open: false });
  });

  it("retains the legacy show visibility alias", () => {
    expect(decodeOpenInput({ show: false })).toEqual({ show: false });
  });
});

describe("PreviewAutomationSnapshot", () => {
  const element = {
    tag: "button",
    role: "button",
    name: "Save",
    selector: "#save",
    x: 0,
    y: 0,
    width: 100,
    height: 40,
  };
  const snapshot = {
    url: "https://example.com",
    title: "Example",
    loading: false,
    visibleText: "Ready",
    interactiveElements: [element],
    accessibilityTree: { nodes: [] },
    consoleEntries: [],
    networkEntries: [],
    actionTimeline: [],
    screenshot: { mimeType: "image/png", data: "AA==", width: 1, height: 1 },
  };

  it("rejects oversized browser text and collection fields", () => {
    expect(() =>
      decodeAutomationSnapshot({
        ...snapshot,
        visibleText: "x".repeat(PREVIEW_AUTOMATION_VISIBLE_TEXT_MAX_LENGTH + 1),
      }),
    ).toThrow();
    expect(() =>
      decodeAutomationSnapshot({
        ...snapshot,
        interactiveElements: Array.from(
          { length: PREVIEW_AUTOMATION_INTERACTIVE_ELEMENTS_MAX_ITEMS + 1 },
          () => element,
        ),
      }),
    ).toThrow();
    expect(() =>
      decodeAutomationSnapshot({
        ...snapshot,
        accessibilityTree: {
          nodes: Array.from(
            { length: PREVIEW_AUTOMATION_ACCESSIBILITY_TREE_MAX_NODES + 1 },
            () => ({}),
          ),
        },
      }),
    ).toThrow();
  });
});

describe("PreviewNavStatus", () => {
  it("decodes Idle", () => {
    expect(decodeNavStatus({ _tag: "Idle" })).toEqual({ _tag: "Idle" });
  });

  it("decodes Loading with title", () => {
    expect(decodeNavStatus({ _tag: "Loading", url: "http://localhost:5173/", title: "" })).toEqual({
      _tag: "Loading",
      url: "http://localhost:5173/",
      title: "",
    });
  });

  it("decodes LoadFailed with code/description", () => {
    expect(
      decodeNavStatus({
        _tag: "LoadFailed",
        url: "https://example.com/",
        title: "Example",
        code: -105,
        description: "ERR_NAME_NOT_RESOLVED",
      }),
    ).toEqual({
      _tag: "LoadFailed",
      url: "https://example.com/",
      title: "Example",
      code: -105,
      description: "ERR_NAME_NOT_RESOLVED",
    });
  });

  it("rejects empty url", () => {
    expect(() => decodeNavStatus({ _tag: "Loading", url: "", title: "" })).toThrow();
  });
});

describe("PreviewSessionSnapshot", () => {
  it("round-trips a Success snapshot", () => {
    const snapshot = decodeSnapshot({
      threadId: "thread-1",
      tabId: "preview-thread-1",
      navStatus: {
        _tag: "Success",
        url: "http://localhost:5173/",
        title: "Vite App",
      },
      canGoBack: false,
      canGoForward: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(snapshot.tabId).toBe("preview-thread-1");
    expect(snapshot.navStatus._tag).toBe("Success");
  });
});

describe("PreviewListResult", () => {
  it("rejects an oversized tab snapshot", () => {
    const snapshot = {
      threadId: "thread-1",
      tabId: "tab-1",
      navStatus: { _tag: "Idle" },
      canGoBack: false,
      canGoForward: false,
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(() =>
      decodePreviewList({
        sessions: Array.from({ length: PREVIEW_SESSIONS_MAX_PER_THREAD + 1 }, () => snapshot),
        serverEpoch: "server",
        revision: 0,
      }),
    ).toThrow();
  });
});

describe("DiscoveredLocalServerList", () => {
  it("rejects more server rows than the discovery ceiling", () => {
    const server = {
      host: "localhost",
      port: 5173,
      url: "http://localhost:5173",
      processName: null,
      pid: null,
      terminal: null,
    };
    expect(() =>
      decodeDiscoveredLocalServerList({
        servers: Array.from({ length: DISCOVERED_LOCAL_SERVERS_MAX_ITEMS + 1 }, () => server),
        scannedAt: "2026-01-01T00:00:00.000Z",
      }),
    ).toThrow();
  });
});

describe("PreviewViewportSetting", () => {
  it("decodes fill, freeform, and preset modes", () => {
    expect(decodeViewport({ _tag: "fill" })).toEqual({ _tag: "fill" });
    expect(decodeViewport({ _tag: "freeform", width: 1024, height: 768 })).toEqual({
      _tag: "freeform",
      width: 1024,
      height: 768,
    });
    expect(
      decodeViewport({
        _tag: "preset",
        presetId: "iphone-15-pro",
        width: 393,
        height: 852,
      }),
    ).toMatchObject({ _tag: "preset", presetId: "iphone-15-pro" });
  });

  it("rejects unsafe dimensions and oversized render areas", () => {
    expect(() => decodeViewport({ _tag: "freeform", width: 100, height: 800 })).toThrow();
    expect(() => decodeViewport({ _tag: "freeform", width: 3840, height: 3840 })).toThrow();
  });
});

describe("PreviewAutomationResizeInput", () => {
  it("requires fields that match the selected mode", () => {
    expect(decodeResizeInput({ mode: "fill" })).toEqual({ mode: "fill" });
    expect(
      decodeResizeInput({ mode: "preset", preset: "pixel-7", orientation: "landscape" }),
    ).toMatchObject({ mode: "preset", preset: "pixel-7" });
    expect(() => decodeResizeInput({ mode: "preset", preset: "pixel-8" })).toThrow();
    expect(() => decodeResizeInput({ mode: "freeform", width: 1024 })).toThrow();
    expect(() => decodeResizeInput({ mode: "fill", width: 1024, height: 768 })).toThrow();
  });

  it("allows fill-mode measurements below the minimum selectable fixed size", () => {
    expect(
      decodeResizeResult({
        tabId: "preview-t",
        setting: { _tag: "fill" },
        viewport: { width: 180, height: 120 },
      }).viewport,
    ).toEqual({ width: 180, height: 120 });
  });
});

describe("preview automation tab targeting", () => {
  it("accepts an explicit tab and rejects contradictory open behavior", () => {
    expect(decodeResizeInput({ tabId: "tab-app", mode: "fill" })).toMatchObject({
      tabId: "tab-app",
      mode: "fill",
    });
    expect(decodeOpenInput({ tabId: "tab-app", reuseExistingTab: true })).toMatchObject({
      tabId: "tab-app",
      reuseExistingTab: true,
    });
    expect(() => decodeOpenInput({ tabId: "tab-app", reuseExistingTab: false })).toThrow();
  });
});

describe("PreviewAutomationHost", () => {
  it("accepts legacy hosts and current operation advertisements", () => {
    expect(decodeAutomationHost({ clientId: "legacy", environmentId: "environment-1" })).toEqual({
      clientId: "legacy",
      environmentId: "environment-1",
    });
    expect(
      decodeAutomationHost({
        clientId: "current",
        environmentId: "environment-1",
        supportedOperations: ["status", "resize"],
      }).supportedOperations,
    ).toEqual(["status", "resize"]);
  });

  it("rejects an oversized operation advertisement", () => {
    expect(() =>
      decodeAutomationHost({
        clientId: "oversized",
        environmentId: "environment-1",
        supportedOperations: [...PREVIEW_AUTOMATION_OPERATIONS, PREVIEW_AUTOMATION_OPERATIONS[0]],
      }),
    ).toThrow();
  });
});

describe("preview automation input limits", () => {
  it("bounds page-controlled targeting and inserted text", () => {
    expect(() =>
      decodeAutomationClick({ selector: "x".repeat(PREVIEW_AUTOMATION_SELECTOR_MAX_LENGTH + 1) }),
    ).toThrow();
    expect(() =>
      decodeAutomationNavigate({
        target: {
          kind: "environment-port",
          port: 5173,
          path: "x".repeat(PREVIEW_URL_MAX_LENGTH + 1),
        },
      }),
    ).toThrow();
    expect(() =>
      decodeAutomationType({ text: "x".repeat(PREVIEW_AUTOMATION_TYPE_TEXT_MAX_LENGTH + 1) }),
    ).toThrow();
    expect(() =>
      decodeAutomationPress({ key: "x".repeat(PREVIEW_AUTOMATION_KEY_MAX_LENGTH + 1) }),
    ).toThrow();
    expect(() =>
      decodeAutomationWaitFor({
        text: "x".repeat(PREVIEW_AUTOMATION_WAIT_TEXT_MAX_LENGTH + 1),
      }),
    ).toThrow();
  });

  it("bounds routed request identity and duration", () => {
    const base = {
      threadId: "thread-1",
      operation: "status",
      input: {},
    } as const;
    expect(() =>
      decodeAutomationRequest({
        ...base,
        requestId: "x".repeat(PREVIEW_AUTOMATION_REQUEST_ID_MAX_LENGTH + 1),
        timeoutMs: 1_000,
      }),
    ).toThrow();
    expect(() =>
      decodeAutomationRequest({ ...base, requestId: "request-1", timeoutMs: 60_001 }),
    ).toThrow();
  });
});

describe("PreviewAutomationError", () => {
  it("preserves a typed non-editable target failure", () => {
    const error = decodeAutomationError({
      _tag: "PreviewAutomationTargetNotEditableError",
      operation: "type",
      environmentId: "environment-1",
      threadId: "thread-1",
      providerSessionId: "provider-session-1",
      providerInstanceId: "codex",
      clientId: "client-1",
      connectionId: "connection-1",
      requestId: "request-1",
      tabId: "tab-1",
      timeoutMs: 1_000,
      remoteTag: "PreviewAutomationTargetNotEditableError",
      remoteMessageLength: 12,
      cause: {},
      selectorKind: "focused-element",
    });

    expect(error._tag).toBe("PreviewAutomationTargetNotEditableError");
    if (error._tag === "PreviewAutomationTargetNotEditableError") {
      expect(error.selectorKind).toBe("focused-element");
      expect(error.message).toBe("Preview automation type requires an editable focused element.");
    }
  });
});

describe("PreviewAutomationStatus", () => {
  it("accepts old hosts without viewport data and exposes it from current hosts", () => {
    const base = {
      available: true,
      visible: false,
      tabId: "preview-t",
      url: "https://example.com",
      title: "Example",
      loading: false,
    };
    expect(decodeAutomationStatus(base)).toEqual(base);
    expect(
      decodeAutomationStatus({
        ...base,
        viewportSetting: { _tag: "preset", presetId: "pixel-8", width: 412, height: 915 },
        viewport: { width: 412, height: 915 },
      }).viewport,
    ).toEqual({ width: 412, height: 915 });
  });

  it("rejects oversized status URLs and titles", () => {
    const base = {
      available: true,
      visible: false,
      tabId: "preview-t",
      url: "https://example.com",
      title: "Example",
      loading: false,
    };
    expect(() =>
      decodeAutomationStatus({
        ...base,
        url: `https://example.com/${"x".repeat(PREVIEW_URL_MAX_LENGTH)}`,
      }),
    ).toThrow();
    expect(() =>
      decodeAutomationStatus({
        ...base,
        title: "x".repeat(PREVIEW_AUTOMATION_PAGE_TITLE_MAX_LENGTH + 1),
      }),
    ).toThrow();
  });
});

describe("PreviewEvent", () => {
  it("decodes opened", () => {
    const event = decodePreviewEvent({
      type: "opened",
      threadId: "t",
      tabId: "preview-t",
      createdAt: "2026-01-01T00:00:00.000Z",
      serverEpoch: "server-a",
      revision: 1,
      snapshot: {
        threadId: "t",
        tabId: "preview-t",
        navStatus: { _tag: "Idle" },
        canGoBack: false,
        canGoForward: false,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(event.type).toBe("opened");
  });

  it("decodes failed with code/description", () => {
    const event = decodePreviewEvent({
      type: "failed",
      threadId: "t",
      tabId: "preview-t",
      createdAt: "2026-01-01T00:00:00.000Z",
      serverEpoch: "server-a",
      revision: 1,
      url: "https://example.com/",
      title: "",
      code: -105,
      description: "ERR_NAME_NOT_RESOLVED",
    });
    expect(event.type).toBe("failed");
    if (event.type === "failed") {
      expect(event.code).toBe(-105);
    }
  });

  it("decodes resized with tab viewport state", () => {
    const event = decodePreviewEvent({
      type: "resized",
      threadId: "t",
      tabId: "preview-t",
      createdAt: "2026-01-01T00:00:00.000Z",
      serverEpoch: "server-a",
      revision: 1,
      snapshot: {
        threadId: "t",
        tabId: "preview-t",
        navStatus: { _tag: "Idle" },
        canGoBack: false,
        canGoForward: false,
        viewport: { _tag: "freeform", width: 1024, height: 768 },
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
    expect(event.type).toBe("resized");
  });

  it("decodes closed without snapshot", () => {
    const event = decodePreviewEvent({
      type: "closed",
      threadId: "t",
      tabId: "preview-t",
      createdAt: "2026-01-01T00:00:00.000Z",
      serverEpoch: "server-a",
      revision: 1,
    });
    expect(event.type).toBe("closed");
  });
});

describe("DiscoveredLocalServer", () => {
  it("decodes a server with process metadata", () => {
    const server = decodeServer({
      host: "localhost",
      port: 5173,
      url: "http://localhost:5173",
      processName: "node",
      pid: 12345,
      terminal: null,
    });
    expect(server.port).toBe(5173);
    expect(server.processName).toBe("node");
  });

  it("decodes a server without process metadata", () => {
    const server = decodeServer({
      host: "localhost",
      port: 3000,
      url: "http://localhost:3000",
      processName: null,
      pid: null,
      terminal: null,
    });
    expect(server.processName).toBeNull();
  });

  it("rejects invalid ports", () => {
    expect(() =>
      decodeServer({
        host: "localhost",
        port: 0,
        url: "http://localhost:0",
        processName: null,
        pid: null,
        terminal: null,
      }),
    ).toThrow();
    expect(() =>
      decodeServer({
        host: "localhost",
        port: 70000,
        url: "http://localhost:70000",
        processName: null,
        pid: null,
        terminal: null,
      }),
    ).toThrow();
  });
});

describe("ConfiguredLocalServerUrls", () => {
  it("bounds the number and length of probe candidates", () => {
    expect(() =>
      decodeConfiguredLocalServerUrls(
        Array.from(
          { length: CONFIGURED_LOCAL_SERVER_URLS_MAX_ITEMS + 1 },
          (_, index) => `http://localhost:${3_000 + index}`,
        ),
      ),
    ).toThrow();
    expect(() =>
      decodeConfiguredLocalServerUrls([`http://localhost/${"a".repeat(PREVIEW_URL_MAX_LENGTH)}`]),
    ).toThrow();
  });
});
