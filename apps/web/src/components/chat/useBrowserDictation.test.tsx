import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { DesktopBridge, DesktopDictationEvent } from "@t3tools/contracts";

import { useBrowserDictation } from "./useBrowserDictation";

class Recognition {
  static instances: Recognition[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  started = false;
  aborted = false;
  onresult:
    | ((event: { results: ArrayLike<{ 0: { transcript: string }; length: number }> }) => void)
    | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    Recognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  stop() {
    this.started = false;
    queueMicrotask(() => this.onend?.());
  }
  abort() {
    this.aborted = true;
    this.started = false;
  }
  emit(transcript: string) {
    this.onresult?.({
      results: [{ 0: { transcript }, length: 1 }],
    });
  }
}

let root: Root;
let dictation: ReturnType<typeof useBrowserDictation>;
let input: Parameters<typeof useBrowserDictation>[0];
let value: string;
let cursor: number;
let reportError: ReturnType<typeof vi.fn<(message: string) => void>>;
let dictationListeners: Array<(event: DesktopDictationEvent) => void>;
let desktopBridge: {
  getClientPlatform: () => string;
  getSystemLocale: () => string;
  startDictation: ReturnType<typeof vi.fn>;
  stopDictation: ReturnType<typeof vi.fn>;
  cancelDictation: ReturnType<typeof vi.fn>;
  onDictationEvent: DesktopBridge["onDictationEvent"];
};

function Probe() {
  const state = useBrowserDictation(input);
  useLayoutEffect(() => {
    dictation = state;
  });
  return null;
}

function stubWindow(bridge?: typeof desktopBridge) {
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {} };
  vi.stubGlobal("document", document);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", {
    document,
    HTMLIFrameElement: EventTarget,
    setTimeout,
    clearTimeout,
    SpeechRecognition: Recognition,
    webkitSpeechRecognition: Recognition,
    desktopBridge: bridge,
  });
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  Recognition.instances = [];
  dictationListeners = [];
  value = "Before after";
  cursor = 6;
  reportError = vi.fn<(message: string) => void>();
  desktopBridge = {
    getClientPlatform: () => "darwin",
    getSystemLocale: () => "en-US",
    startDictation: vi.fn(async () => undefined),
    stopDictation: vi.fn(async () => undefined),
    cancelDictation: vi.fn(async () => undefined),
    onDictationEvent: (listener) => {
      dictationListeners.push(listener);
      return () => {
        dictationListeners = dictationListeners.filter((entry) => entry !== listener);
      };
    },
  };
  stubWindow();
  input = {
    ownerKey: "thread-a",
    enabled: true,
    readComposer: () => ({ value, cursor }),
    replaceInsertion: (start, previous, next) => {
      if (value.slice(start, start + previous.length) !== previous) return false;
      value = value.slice(0, start) + next + value.slice(start + previous.length);
      cursor = start + next.length;
      return true;
    },
    reportError,
  };
  const container = {
    nodeType: 1,
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {},
  };
  root = createRoot(container as unknown as HTMLElement);
  await act(() => root.render(<Probe />));
});

afterEach(async () => {
  await act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser composer dictation", () => {
  it("inserts live speech at the captured caret without a host round-trip", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    expect(dictation.phase).toBe("recording");
    expect(Recognition.instances).toHaveLength(1);
    await act(() => {
      Recognition.instances[0]?.emit("first thought");
    });
    expect(value).toBe("Before first thought after");
    await act(async () => {
      await dictation.toggle();
    });
    expect(dictation.phase).toBe("idle");
    expect(value).toBe("Before first thought after");
    expect(reportError).not.toHaveBeenCalled();
  });

  it("cancels a preview without allowing a late result to reinsert text", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    await act(() => {
      Recognition.instances[0]?.emit("last chunk");
    });
    await act(() => dictation.cancel());
    expect(value).toBe("Before after");
    await act(() => {
      Recognition.instances[0]?.emit("late transcript");
    });
    expect(value).toBe("Before after");
    expect(dictation.phase).toBe("idle");
  });

  it("does not insert into another thread with identical text", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    const recognition = Recognition.instances[0];
    input = { ...input, ownerKey: "thread-b" };
    await act(() => root.render(<Probe />));
    await act(() => {
      recognition?.emit("from old thread");
    });
    expect(value).toBe("Before after");
    expect(dictation.phase).toBe("idle");
  });

  it("refuses to overwrite an external draft edit", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    value = "My edited draft";
    await act(() => {
      Recognition.instances[0]?.emit("dictated text");
    });
    expect(value).toBe("My edited draft");
    expect(reportError).toHaveBeenCalledWith("The composer changed while dictation was running.");
  });

  it("returns to idle after denied microphone permission", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    await act(() => {
      Recognition.instances[0]?.onerror?.({ error: "not-allowed" });
      Recognition.instances[0]?.onend?.();
    });
    expect(dictation.phase).toBe("idle");
    expect(reportError).toHaveBeenCalledWith(
      expect.stringContaining("Microphone access was denied"),
    );
  });

  it("keeps an in-flight recording when starting is blocked", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    expect(dictation.phase).toBe("recording");
    input = { ...input, canStart: false };
    await act(() => root.render(<Probe />));
    expect(dictation.phase).toBe("recording");
    expect(Recognition.instances[0]?.started).toBe(true);
  });

  it("cancels capture when the composer becomes unavailable", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    expect(dictation.phase).toBe("recording");
    input = { ...input, enabled: false };
    await act(() => root.render(<Probe />));
    expect(Recognition.instances[0]?.aborted).toBe(true);
    expect(dictation.phase).toBe("idle");
    expect(value).toBe("Before after");
  });

  it("does not begin a new recording while starting is blocked", async () => {
    input = { ...input, canStart: false };
    await act(() => root.render(<Probe />));
    await act(async () => {
      await dictation.toggle();
    });
    expect(Recognition.instances).toHaveLength(0);
    expect(dictation.phase).toBe("idle");
  });

  it("aborts web speech if the composer changes before recording begins", async () => {
    const originalStart = Recognition.prototype.start;
    Recognition.prototype.start = function (this: Recognition) {
      cursor = 0;
      this.started = true;
    };
    try {
      await act(async () => {
        await dictation.toggle();
      });
    } finally {
      Recognition.prototype.start = originalStart;
    }
    expect(Recognition.instances[0]?.aborted).toBe(true);
    expect(dictation.phase).toBe("idle");
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining("composer changed"));
    expect(value).toBe("Before after");
  });

  it("cancels prepare when toggled again before recording starts", async () => {
    let resolvePermission!: () => void;
    const permission = new Promise<void>((resolve) => {
      resolvePermission = resolve;
    });
    desktopBridge.startDictation.mockReturnValueOnce(permission);
    stubWindow(desktopBridge);
    await act(() => root.render(<Probe />));
    let starting: Promise<void> | void;
    await act(async () => {
      starting = dictation.toggle();
    });
    expect(dictation.phase).toBe("preparing");
    await act(() => {
      dictation.toggle();
    });
    expect(dictation.phase).toBe("idle");
    await act(async () => {
      resolvePermission();
      await starting;
    });
    expect(desktopBridge.cancelDictation).toHaveBeenCalled();
    expect(dictation.phase).toBe("idle");
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("macOS desktop dictation", () => {
  beforeEach(async () => {
    stubWindow(desktopBridge);
    await act(() => root.render(<Probe />));
  });

  it("inserts Speech.framework transcripts through the desktop bridge", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    expect(desktopBridge.startDictation).toHaveBeenCalledWith({ locale: "en-US" });
    expect(Recognition.instances).toHaveLength(0);
    expect(dictation.phase).toBe("recording");
    await act(() => {
      dictationListeners[0]?.({ type: "transcript", text: "native speech" });
    });
    expect(value).toBe("Before native speech after");
    await act(async () => {
      await dictation.toggle();
    });
    expect(desktopBridge.stopDictation).toHaveBeenCalled();
    await act(() => {
      dictationListeners[0]?.({ type: "ended" });
    });
    expect(dictation.phase).toBe("idle");
    expect(value).toBe("Before native speech after");
  });

  it("hides Electron dictation off macOS", async () => {
    desktopBridge.getClientPlatform = () => "linux";
    stubWindow(desktopBridge);
    await act(() => root.render(<Probe />));
    await act(async () => {
      await dictation.toggle();
    });
    expect(desktopBridge.startDictation).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining("not available"));
    expect(dictation.phase).toBe("idle");
  });
});
