import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { RelayConnectionTarget, type PreparedConnection } from "@t3tools/client-runtime/connection";

const mocks = vi.hoisted(() => ({ runPromise: vi.fn() }));
vi.mock("../../lib/runtime", () => ({ runtime: { runPromise: mocks.runPromise } }));

import { useBrowserDictation } from "./useBrowserDictation";

const environmentId = EnvironmentId.make("groq-host");
const prepared: PreparedConnection = {
  environmentId,
  label: "Groq host",
  target: new RelayConnectionTarget({ environmentId, label: "Groq host" }),
  httpBaseUrl: "https://groq-host.example.test",
  socketUrl: "wss://groq-host.example.test/ws",
  httpAuthorization: { _tag: "Bearer", token: "session-token" },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

class Recorder {
  static instances: Recorder[] = [];
  static isTypeSupported() {
    return true;
  }
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    Recorder.instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({ data: new Blob(["audio"]) });
      this.onstop?.();
    });
  }
}

let root: Root;
let dictation: ReturnType<typeof useBrowserDictation>;
let input: Parameters<typeof useBrowserDictation>[0];
let value: string;
let cursor: number;
let stopTrack: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;
let reportError: ReturnType<typeof vi.fn<(message: string) => void>>;

function Probe() {
  const state = useBrowserDictation(input);
  useLayoutEffect(() => {
    dictation = state;
  });
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  mocks.runPromise.mockReset();
  mocks.runPromise.mockResolvedValueOnce({ available: true, reason: null });
  mocks.runPromise.mockResolvedValue({ text: "dictated text" });
  Recorder.instances = [];
  value = "Before after";
  cursor = 6;
  reportError = vi.fn<(message: string) => void>();
  stopTrack = vi.fn();
  getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal(
    "FileReader",
    class {
      result = "data:audio/webm;base64,YXVkaW8=";
      loadListener: (() => void) | null = null;
      addEventListener(event: string, callback: () => void) {
        if (event === "load") this.loadListener = callback;
      }
      readAsDataURL() {
        this.loadListener?.();
      }
    },
  );
  const document = { nodeType: 9, addEventListener() {}, removeEventListener() {} };
  const container = {
    nodeType: 1,
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
    addEventListener() {},
    removeEventListener() {},
  };
  vi.stubGlobal("document", document);
  vi.stubGlobal("window", { document, HTMLIFrameElement: EventTarget, setTimeout, clearTimeout });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  input = {
    ownerKey: "thread-a",
    enabled: true,
    prepared,
    readComposer: () => ({ value, cursor }),
    replaceInsertion: (start, previous, next) => {
      if (value.slice(start, start + previous.length) !== previous) return false;
      value = value.slice(0, start) + next + value.slice(start + previous.length);
      cursor = start + next.length;
      return true;
    },
    reportError,
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
  it("inserts chunks at the captured caret, releases the microphone before cleanup, and replaces only its text", async () => {
    mocks.runPromise.mockResolvedValueOnce({ text: "first thought" });
    // The availability result was queued first; subsequent responses are audio and cleanup.
    await act(async () => {
      await dictation.toggle();
    });
    expect(dictation.phase).toBe("recording");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(value).toBe("Before first thought after");
    const cleanup = deferred<{ text: string }>();
    mocks.runPromise
      .mockResolvedValueOnce({ text: "second thought" })
      .mockReturnValueOnce(cleanup.promise);
    await act(async () => {
      await dictation.toggle();
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(dictation.phase).toBe("processing");
    expect(value).toBe("Before first thought second thought after");
    await act(async () => {
      cleanup.resolve({ text: "A clear thought." });
    });
    expect(value).toBe("Before A clear thought. after");
    expect(dictation.phase).toBe("idle");
    expect(reportError).not.toHaveBeenCalled();
  });

  it("keeps the raw transcript if cleanup fails", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    mocks.runPromise
      .mockResolvedValueOnce({ text: "raw speech" })
      .mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await dictation.toggle();
    });
    expect(value).toBe("Before raw speech after");
    expect(dictation.phase).toBe("idle");
    expect(reportError).toHaveBeenCalledWith("Voice cleanup failed; the raw transcript was kept.");
  });

  it("cancels a preview and aborts cleanup without allowing a late result to reinsert text", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    const cleanup = deferred<{ text: string }>();
    mocks.runPromise
      .mockResolvedValueOnce({ text: "last chunk" })
      .mockReturnValueOnce(cleanup.promise);
    await act(async () => {
      await dictation.toggle();
    });
    const signal = mocks.runPromise.mock.lastCall?.[1].signal as AbortSignal;
    await act(() => dictation.cancel());
    expect(value).toBe("Before after");
    expect(signal.aborted).toBe(true);
    await act(async () => {
      cleanup.resolve({ text: "late cleanup" });
    });
    expect(value).toBe("Before after");
    expect(dictation.phase).toBe("idle");
  });

  it("does not insert into another thread with identical text", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    const transcription = deferred<{ text: string }>();
    mocks.runPromise.mockReturnValueOnce(transcription.promise);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    input = { ...input, ownerKey: "thread-b" };
    await act(() => root.render(<Probe />));
    expect(stopTrack).toHaveBeenCalled();
    await act(async () => {
      transcription.resolve({ text: "from old thread" });
    });
    expect(value).toBe("Before after");
    expect(dictation.phase).toBe("idle");
  });

  it("releases a microphone permission result that arrives after switching threads", async () => {
    const permission = deferred<{ getTracks: () => { stop: typeof stopTrack }[] }>();
    getUserMedia.mockReturnValueOnce(permission.promise);
    let starting: Promise<void> | void;
    await act(async () => {
      starting = dictation.toggle();
    });
    expect(dictation.phase).toBe("preparing");
    input = { ...input, ownerKey: "thread-b" };
    await act(() => root.render(<Probe />));
    await act(async () => {
      permission.resolve({ getTracks: () => [{ stop: stopTrack }] });
      await starting;
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(Recorder.instances).toHaveLength(0);
    expect(dictation.phase).toBe("idle");
  });

  it("refuses to overwrite an external draft edit", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    value = "My edited draft";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(value).toBe("My edited draft");
    expect(stopTrack).toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith("The composer changed while dictation was running.");
  });

  it("explains setup when no configured host is connected", async () => {
    input = { ...input, prepared: null };
    await act(() => root.render(<Probe />));
    await act(async () => {
      await dictation.toggle();
    });
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining("GROQ_API_KEY"));
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(dictation.phase).toBe("idle");
  });

  it("returns to idle after denied microphone permission", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    await act(async () => {
      await dictation.toggle();
    });
    expect(dictation.phase).toBe("idle");
    expect(reportError).toHaveBeenCalledWith(
      expect.stringContaining("Microphone access was denied"),
    );
  });

  it("releases capture after recorder failure", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    await act(async () => {
      Recorder.instances[0]?.onerror?.();
    });
    expect(stopTrack).toHaveBeenCalled();
    expect(dictation.phase).toBe("idle");
    expect(reportError).toHaveBeenCalledWith(expect.stringContaining("microphone stopped"));
  });

  it("keeps an in-flight recording when starting is blocked", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    expect(dictation.phase).toBe("recording");
    input = { ...input, canStart: false };
    await act(() => root.render(<Probe />));
    expect(dictation.phase).toBe("recording");
    expect(stopTrack).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("cancels capture when the composer becomes unavailable", async () => {
    await act(async () => {
      await dictation.toggle();
    });
    expect(dictation.phase).toBe("recording");
    input = { ...input, enabled: false };
    await act(() => root.render(<Probe />));
    expect(stopTrack).toHaveBeenCalled();
    expect(dictation.phase).toBe("idle");
    expect(value).toBe("Before after");
  });

  it("does not begin a new recording while starting is blocked", async () => {
    input = { ...input, canStart: false };
    await act(() => root.render(<Probe />));
    await act(async () => {
      await dictation.toggle();
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(dictation.phase).toBe("idle");
  });
});
