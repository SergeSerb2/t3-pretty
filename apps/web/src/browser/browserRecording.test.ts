import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ensureClientSettingsHydrated } from "~/hooks/useSettings";

const {
  events,
  frameSubscription,
  onFrame,
  registrySet,
  save,
  startScreencast,
  stopScreencast,
  surfaceState,
} = vi.hoisted(() => {
  const events: string[] = [];
  type Frame = {
    readonly tabId: string;
    readonly data: Uint8Array;
    readonly width: number;
    readonly height: number;
    readonly receivedAt: string;
  };
  const frameSubscription: { listener: ((frame: Frame) => void) | null } = {
    listener: null,
  };
  const surfaceState = {
    byTabId: {} as Record<string, unknown>,
  };
  return {
    events,
    frameSubscription,
    onFrame: vi.fn((listener: (frame: Frame) => void) => {
      frameSubscription.listener = listener;
      return () => {
        if (frameSubscription.listener === listener) frameSubscription.listener = null;
      };
    }),
    registrySet: vi.fn((_atom: unknown, value: { readonly tabIds: ReadonlySet<string> }) => {
      events.push(
        value.tabIds.size === 0 ? "clear" : `publish:${Array.from(value.tabIds).join(",")}`,
      );
    }),
    save: vi.fn(async (tabId: string) => ({
      id: "recording-test",
      tabId,
      path: "/tmp/recording-test.webm",
      mimeType: "video/webm" as const,
      sizeBytes: 0,
      createdAt: "2026-06-26T00:00:00.000Z",
    })),
    startScreencast: vi.fn(async (tabId: string) => {
      events.push("start-screencast");
      const surface = surfaceState.byTabId[tabId] as
        | {
            readonly content?: { readonly width: number; readonly height: number };
            readonly rect?: { readonly width: number; readonly height: number };
          }
        | undefined;
      const size = surface?.content ?? surface?.rect;
      frameSubscription.listener?.({
        tabId,
        data: new TextEncoder().encode("initial-frame"),
        width: size?.width ?? 1280,
        height: size?.height ?? 800,
        receivedAt: "2026-06-26T00:00:00.000Z",
      });
    }),
    stopScreencast: vi.fn(async () => undefined),
    surfaceState,
  };
});

vi.mock("~/components/preview/previewBridge", () => ({
  previewBridge: {
    recording: { onFrame, save, startScreencast, stopScreencast },
  },
}));

vi.mock("~/rpc/atomRegistry", () => ({
  appAtomRegistry: { set: registrySet },
}));

vi.mock("./browserSurfaceStore", () => ({
  useBrowserSurfaceStore: {
    getState: () => surfaceState,
  },
}));

import {
  BROWSER_RECORDING_FIRST_FRAME_SIZE_TIMEOUT_MS,
  BROWSER_RECORDING_STARTUP_SETTLE_TIMEOUT_MS,
  BrowserRecordingConflictError,
  findActiveBrowserRecordingRuntimeTabId,
  readActiveBrowserRecordingTabIds,
  readActiveBrowserRecordingTargets,
  startBrowserRecording,
  stopBrowserRecording,
} from "./browserRecording";
import { previewRuntimeTabId } from "./previewRuntimeTabId";

const frameBytes = (value: string): Uint8Array => new TextEncoder().encode(value);

class FakeMediaRecorder {
  static isTypeSupported(): boolean {
    return true;
  }

  state: RecordingState = "inactive";
  readonly stream = { getTracks: () => [] };
  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.get(type)?.delete(listener);
  }
  private readonly listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    for (const listener of this.listeners.get("stop") ?? []) {
      if (typeof listener === "function") listener(new Event("stop"));
      else listener.handleEvent(new Event("stop"));
    }
  }
}

const emitRecordingFrame = () => {
  frameSubscription.listener?.({
    tabId: "recording-tab",
    data: frameBytes("startup-frame"),
    width: 800,
    height: 600,
    receivedAt: "2026-06-26T00:00:00.000Z",
  });
};

describe("browser recording", () => {
  beforeEach(() => {
    events.length = 0;
    frameSubscription.listener = null;
    surfaceState.byTabId = {
      "recording-tab": {
        visible: true,
        rect: { x: 0, y: 0, width: 800, height: 600 },
        content: { x: 0, y: 0, width: 800, height: 600, scale: 1, scrollLeft: 0, scrollTop: 0 },
      },
    };
    vi.clearAllMocks();
    vi.stubGlobal("window", globalThis);
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder as unknown as typeof MediaRecorder);
    getDisplayMedia.mockResolvedValue({
      getVideoTracks: () => [],
      getTracks: () => [{ stop: vi.fn() }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts recording for a visible tab", async () => {
    await startBrowserRecording("recording-tab");
    const startupEvents = [...events];

    await stopBrowserRecording("recording-tab");
    expect(startupEvents).toEqual(["publish:recording-tab", "start-screencast"]);
  });

  it("records a hidden tab without requiring it to become visible", async () => {
    surfaceState.byTabId = {
      "recording-tab": {
        visible: false,
        rect: { x: 0, y: 0, width: 800, height: 600 },
        content: { x: 0, y: 0, width: 800, height: 600, scale: 1, scrollLeft: 0, scrollTop: 0 },
      },
    };

    await startBrowserRecording("recording-tab");
    const startupEvents = [...events];

    expect(startScreencast).toHaveBeenCalledWith("recording-tab");
    await stopBrowserRecording("recording-tab");
    expect(startupEvents).toEqual(["publish:recording-tab", "start-screencast"]);
  });

  it("paints and holds a hidden browser surface for the recording lifetime", async () => {
    startScreencast.mockImplementationOnce(async (tabId: string) => {
      expect(animationFrameCount).toBe(2);
      expect(useBrowserSurfaceStore.getState().activityByTabId[tabId]).toBe(1);
    });
    getDisplayMedia.mockImplementationOnce(async () => {
      expect(animationFrameCount).toBe(2);
      expect(useBrowserSurfaceStore.getState().activityByTabId["background-tab"]).toBe(1);
      return { getVideoTracks: () => [], getTracks: () => [{ stop: vi.fn() }] };
    });

    await startBrowserRecording("background-tab");
    expect(useBrowserSurfaceStore.getState().activityByTabId["background-tab"]).toBe(1);

    await stopBrowserRecording("background-tab");
    expect(useBrowserSurfaceStore.getState().activityByTabId["background-tab"]).toBeUndefined();
  });

  it("bounds compositor warmup when animation frames are paused", async () => {
    vi.useFakeTimers();
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 42),
    );
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);

    const startPromise = startBrowserRecording("hidden-window-tab");
    await vi.advanceTimersByTimeAsync(BROWSER_RECORDING_PAINT_SETTLE_TIMEOUT_MS);

    await startPromise;
    expect(cancelAnimationFrame).toHaveBeenCalledWith(42);
    await stopBrowserRecording("hidden-window-tab");
  });

  it.each([
    { width: 1280, height: 720, frameRate: 60, bitrate: 2_764_800 },
    { width: 320, height: 240, frameRate: 30, bitrate: 2_500_000 },
    { width: 3840, height: 2160, frameRate: 60, bitrate: 24_883_200 },
    { width: 7680, height: 4320, frameRate: 60, bitrate: 50_000_000 },
  ])("records the native $width x $height stream at $frameRate fps", async (settings) => {
    const stopTrack = vi.fn();
    const stream = {
      getVideoTracks: () => [{ getSettings: () => settings }],
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream;
    getDisplayMedia.mockResolvedValueOnce(stream);

    await startBrowserRecording("recording-tab");

    expect(getDisplayMedia).toHaveBeenCalledWith({
      audio: false,
      video: { frameRate: { ideal: 30, max: 30 } },
    });
    expect(FakeMediaRecorder.instances[0]?.stream).toBe(stream);
    expect(FakeMediaRecorder.instances[0]?.options?.videoBitsPerSecond).toBe(settings.bitrate);

    await stopBrowserRecording("recording-tab");
    expect(stopTrack).toHaveBeenCalledOnce();
    expect(stopTrack.mock.invocationCallOrder[0]).toBeLessThan(save.mock.invocationCallOrder[0]!);
  });

  it("uses the configured recording frame rate", async () => {
    clientSettings.browserRecordingFrameRate = 60;

    await startBrowserRecording("recording-tab");

    expect(getDisplayMedia).toHaveBeenCalledWith({
      audio: false,
      video: { frameRate: { ideal: 60, max: 60 } },
    });
    await stopBrowserRecording("recording-tab");
  });

  it("clears a failed settings read before retrying recording", async () => {
    const tabId = "settings-read-failure-tab";
    const error = new Error("Settings read failed");
    vi.mocked(ensureClientSettingsHydrated).mockRejectedValueOnce(error);

    await expect(startBrowserRecording(tabId)).rejects.toBe(error);

    expect(readActiveBrowserRecordingTabIds()).toEqual(new Set());
    expect(useBrowserSurfaceStore.getState().activityByTabId[tabId]).toBeUndefined();
    expect(animationFrameCount).toBe(0);
    expect(startScreencast).not.toHaveBeenCalled();
    expect(stopScreencast).not.toHaveBeenCalled();
    expect(getDisplayMedia).not.toHaveBeenCalled();
    expect(FakeMediaRecorder.instances).toHaveLength(0);

    clientSettings.browserRecordingFrameRate = 60;
    await startBrowserRecording(tabId);

    expect(getDisplayMedia).toHaveBeenCalledWith({
      audio: false,
      video: { frameRate: { ideal: 60, max: 60 } },
    });
    await stopBrowserRecording(tabId);

    expect(startScreencast).toHaveBeenCalledOnce();
    expect(readActiveBrowserRecordingTabIds()).toEqual(new Set());
    expect(useBrowserSurfaceStore.getState().activityByTabId[tabId]).toBeUndefined();
  });

  it("stops the native stream when MediaRecorder cleanup fails", async () => {
    const stopTrack = vi.fn();
    getDisplayMedia.mockResolvedValueOnce({
      getVideoTracks: () => [],
      getTracks: () => [{ stop: stopTrack }],
    });

    await startBrowserRecording("recording-tab");
    FakeMediaRecorder.stopError = new Error("stop failed");

    await expect(stopBrowserRecording("recording-tab")).rejects.toMatchObject({
      operation: "cleanup",
      tabId: "recording-tab",
    });
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("uses the best supported encoder and saves the recorder's actual format", async () => {
    FakeMediaRecorder.supportedTypes = new Set([
      "video/mp4;codecs=avc1",
      "video/mp4;codecs=avc1.42e01e",
      "video/webm;codecs=vp9",
      "video/webm;codecs=av1",
    ]);
    FakeMediaRecorder.outputMimeType = "video/webm;codecs=av01";

    await startBrowserRecording("recording-tab");
    await stopBrowserRecording("recording-tab");

    expect(FakeMediaRecorder.instances[0]?.options).toEqual({
      mimeType: "video/mp4;codecs=avc1",
      videoBitsPerSecond: 3_110_400,
    });
    expect(save).toHaveBeenCalledWith(
      "recording-tab",
      "video/webm;codecs=av01",
      expect.any(Uint8Array),
    );
  });

  it("lets the browser select the format when no preferred encoding is supported", async () => {
    FakeMediaRecorder.supportedTypes = new Set();
    FakeMediaRecorder.outputMimeType = "video/platform-default";

    await startBrowserRecording("recording-tab");
    await stopBrowserRecording("recording-tab");

    expect(FakeMediaRecorder.instances[0]?.options).toEqual({ videoBitsPerSecond: 3_110_400 });
    expect(save).toHaveBeenCalledWith(
      "recording-tab",
      "video/platform-default",
      expect.any(Uint8Array),
    );
  });

  it("reports when MediaRecorder provides no output format", async () => {
    FakeMediaRecorder.supportedTypes = new Set();
    FakeMediaRecorder.outputMimeType = "";

    await startBrowserRecording("recording-tab");

    await expect(stopBrowserRecording("recording-tab")).rejects.toBeInstanceOf(
      BrowserRecordingFormatUnavailableError,
    );
    expect(save).not.toHaveBeenCalled();
    expect(readActiveBrowserRecordingTabIds()).toEqual(new Set());
  });

  it("releases the native capture lease when stream acquisition fails", async () => {
    getDisplayMedia.mockRejectedValueOnce(new Error("capture failed"));

    await expect(startBrowserRecording("recording-tab")).rejects.toMatchObject({
      operation: "capture-media-stream",
      tabId: "recording-tab",
    });
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(BROWSER_RECORDING_FIRST_FRAME_SIZE_TIMEOUT_MS);

    await rejection;
    expect(stopScreencast).toHaveBeenCalledWith("recording-tab");
    expect(events.at(-1)).toBe("clear");
  });

  it("fixes hidden recording dimensions before MediaRecorder starts", async () => {
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    let capturedStreamSize: { readonly width: number; readonly height: number } | undefined;
    const canvas = {
      width: 0,
      height: 0,
      captureStream: () => {
        capturedStreamSize = { width: canvas.width, height: canvas.height };
        return {};
      },
      getContext: () => ({ drawImage, fillRect, fillStyle: "" }),
    };
    vi.stubGlobal("document", {
      createElement: () => canvas,
    });
    surfaceState.byTabId = {};
    startScreencast.mockImplementationOnce(async (tabId: string) => {
      events.push("start-screencast");
      frameSubscription.listener?.({
        tabId,
        data: frameBytes("captured-frame"),
        width: 390,
        height: 844,
        receivedAt: "2026-06-26T00:00:00.000Z",
      });
    });

    await startBrowserRecording("recording-tab");

    finishCapture({
      getVideoTracks: () => [],
      getTracks: () => [{ stop: stopTrack }],
    } as unknown as MediaStream);
    await vi.advanceTimersByTimeAsync(0);
    expect(stopTrack).toHaveBeenCalledOnce();
  });

  it("records separate tabs concurrently", async () => {
    const firstThreadRef = {
      environmentId: EnvironmentId.make("environment-recording"),
      threadId: ThreadId.make("thread-recording-first"),
    };
    const secondThreadRef = {
      environmentId: EnvironmentId.make("environment-recording"),
      threadId: ThreadId.make("thread-recording-second"),
    };
    surfaceState.byTabId = {
      ...surfaceState.byTabId,
      "recording-tab-2": {
        visible: false,
        rect: { x: 0, y: 0, width: 390, height: 844 },
        content: { x: 0, y: 0, width: 390, height: 844, scale: 1, scrollLeft: 0, scrollTop: 0 },
      },
    };

    await Promise.all([
      startBrowserRecording("recording-tab", firstThreadRef),
      startBrowserRecording("recording-tab-2", secondThreadRef),
    ]);

    expect(startScreencast).toHaveBeenCalledTimes(2);
    expect(onFrame).toHaveBeenCalledOnce();
    expect(events).toContain("publish:recording-tab,recording-tab-2");
    expect(readActiveBrowserRecordingTabIds()).toEqual(
      new Set(["recording-tab", "recording-tab-2"]),
    );
    expect(readActiveBrowserRecordingTabIds(firstThreadRef)).toEqual(new Set(["recording-tab"]));
    expect(readActiveBrowserRecordingTabIds(secondThreadRef)).toEqual(new Set(["recording-tab-2"]));

    await stopBrowserRecording("recording-tab");
    expect(readActiveBrowserRecordingTabIds()).toEqual(new Set(["recording-tab-2"]));
    await stopBrowserRecording("recording-tab-2");
    expect(readActiveBrowserRecordingTabIds()).toEqual(new Set());
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("serializes display media grants for concurrent recording starts", async () => {
    let finishFirstCapture!: (stream: MediaStream) => void;
    const stream = {
      getVideoTracks: () => [],
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    getDisplayMedia
      .mockImplementationOnce(
        () =>
          new Promise<MediaStream>((resolve) => {
            finishFirstCapture = resolve;
          }),
      )
      .mockResolvedValueOnce(stream);

    const firstStart = startBrowserRecording("recording-tab");
    await vi.waitFor(() => expect(getDisplayMedia).toHaveBeenCalledOnce());
    const secondStart = startBrowserRecording("recording-tab-2");
    await vi.waitFor(() => expect(readActiveBrowserRecordingTabIds().size).toBe(2));

    expect(startScreencast).toHaveBeenCalledTimes(1);
    finishFirstCapture(stream);
    await Promise.all([firstStart, secondStart]);

    expect(startScreencast.mock.calls).toEqual([["recording-tab"], ["recording-tab-2"]]);
    expect(getDisplayMedia).toHaveBeenCalledTimes(2);
    await Promise.all([
      stopBrowserRecording("recording-tab"),
      stopBrowserRecording("recording-tab-2"),
    ]);
  });

  it("cancels a queued recording when stopped before its media grant", async () => {
    let finishFirstCapture!: (stream: MediaStream) => void;
    const stream = {
      getVideoTracks: () => [],
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    getDisplayMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          finishFirstCapture = resolve;
        }),
    );

    const firstStart = startBrowserRecording("recording-tab");
    await vi.waitFor(() => expect(getDisplayMedia).toHaveBeenCalledOnce());
    const secondStart = startBrowserRecording("recording-tab-2");
    await vi.waitFor(() => expect(readActiveBrowserRecordingTabIds().size).toBe(2));

    const secondStop = stopBrowserRecording("recording-tab-2");
    await expect(secondStart).rejects.toBeInstanceOf(BrowserRecordingStartCancelledError);
    await expect(secondStop).resolves.toBeNull();
    expect(startScreencast).toHaveBeenCalledTimes(1);

    finishFirstCapture(stream);
    await firstStart;
    await stopBrowserRecording("recording-tab");
    expect(getDisplayMedia).toHaveBeenCalledOnce();
  });

  it("latches a stop that arrives before the start becomes queued", async () => {
    let releaseDelayedPaint!: (timestamp: number) => void;
    let frameId = 0;
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        frameId += 1;
        if (frameId === 1) releaseDelayedPaint = callback;
        else callback(frameId);
        return frameId;
      }),
    );
    let finishBlockingCapture!: (stream: MediaStream) => void;
    const stream = {
      getVideoTracks: () => [],
      getTracks: () => [{ stop: vi.fn() }],
    } as unknown as MediaStream;
    getDisplayMedia.mockImplementationOnce(
      () =>
        new Promise<MediaStream>((resolve) => {
          finishBlockingCapture = resolve;
        }),
    );

    const delayedStart = startBrowserRecording("delayed-tab");
    await vi.waitFor(() =>
      expect(readActiveBrowserRecordingTabIds().has("delayed-tab")).toBe(true),
    );
    const blockingStart = startBrowserRecording("blocking-tab");
    await vi.waitFor(() => expect(getDisplayMedia).toHaveBeenCalledOnce());

    const delayedStop = stopBrowserRecording("delayed-tab");
    releaseDelayedPaint(1);

    await expect(delayedStart).rejects.toBeInstanceOf(BrowserRecordingStartCancelledError);
    await expect(delayedStop).resolves.toBeNull();
    expect(startScreencast).toHaveBeenCalledOnce();

    finishBlockingCapture(stream);
    await blockingStart;
    await stopBrowserRecording("blocking-tab");
  });

  it("finishes an uncontended pre-grant start before stopping", async () => {
    const animationFrames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      }),
    );

    const startPromise = startBrowserRecording("recording-tab");
    await vi.waitFor(() =>
      expect(readActiveBrowserRecordingTabIds().has("recording-tab")).toBe(true),
    );
    const stopPromise = stopBrowserRecording("recording-tab");
    expect(startScreencast).not.toHaveBeenCalled();

    animationFrames.shift()?.(1);
    animationFrames.shift()?.(2);
    await startPromise;
    await expect(stopPromise).resolves.toMatchObject({ tabId: "recording-tab" });
  });

  it("keeps a recording reachable through its runtime id after a server epoch changes", async () => {
    const threadRef = {
      environmentId: EnvironmentId.make("environment-recording"),
      threadId: ThreadId.make("thread-recording-scoped"),
    };
    const runtimeTabId = previewRuntimeTabId(threadRef, "epoch-a", "tab_1");
    surfaceState.byTabId = {
      [runtimeTabId]: {
        visible: false,
        rect: { x: 0, y: 0, width: 1280, height: 800 },
        content: {
          x: 0,
          y: 0,
          width: 1280,
          height: 800,
          scale: 1,
          scrollLeft: 0,
          scrollTop: 0,
        },
      },
    };

    await startBrowserRecording(runtimeTabId, threadRef, "tab_1");

    expect(startScreencast).toHaveBeenCalledWith(runtimeTabId);
    expect(readActiveBrowserRecordingTabIds(threadRef)).toEqual(new Set([runtimeTabId]));
    expect(readActiveBrowserRecordingTargets(threadRef)).toEqual([
      { runtimeTabId, serverTabId: "tab_1" },
    ]);
    expect(findActiveBrowserRecordingRuntimeTabId(threadRef, "tab_1")).toBe(runtimeTabId);

    const replacementRuntimeTabId = previewRuntimeTabId(threadRef, "epoch-b", "tab_1");
    await expect(
      startBrowserRecording(replacementRuntimeTabId, threadRef, "tab_1"),
    ).rejects.toBeInstanceOf(BrowserRecordingConflictError);
    expect(startScreencast).toHaveBeenCalledTimes(1);

    await stopBrowserRecording(runtimeTabId);
  });

  it("does not report success for a second start while the first is still starting", async () => {
    let finishStartingScreencast: (() => void) | undefined;
    startScreencast.mockImplementationOnce(async (tabId: string) => {
      events.push("start-screencast");
      frameSubscription.listener?.({
        tabId,
        data: frameBytes("initial-frame"),
        width: 800,
        height: 600,
        receivedAt: "2026-06-26T00:00:00.000Z",
      });
      await new Promise<void>((resolve) => {
        finishStartingScreencast = resolve;
      });
    });

    const firstStart = startBrowserRecording("recording-tab");
    await vi.waitFor(() => expect(startScreencast).toHaveBeenCalledOnce());

    await expect(startBrowserRecording("recording-tab")).rejects.toBeInstanceOf(
      BrowserRecordingConflictError,
    );

    finishStartingScreencast?.();
    await firstStart;
    await stopBrowserRecording("recording-tab");
  });

  it("does not report success for a start while the recording is stopping", async () => {
    let finishStoppingScreencast: (() => void) | undefined;
    stopScreencast.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finishStoppingScreencast = resolve;
      });
      return undefined;
    });

    await startBrowserRecording("recording-tab");
    const stopPromise = stopBrowserRecording("recording-tab");
    await vi.waitFor(() => expect(stopScreencast).toHaveBeenCalledOnce());

    await expect(startBrowserRecording("recording-tab")).rejects.toBeInstanceOf(
      BrowserRecordingConflictError,
    );

    finishStoppingScreencast?.();
    await stopPromise;
  });

  it("shares an in-progress stop with duplicate callers", async () => {
    let finishStoppingScreencast: (() => void) | undefined;
    stopScreencast.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        finishStoppingScreencast = resolve;
      });
      return undefined;
    });

    await startBrowserRecording("recording-tab");
    const firstStop = stopBrowserRecording("recording-tab");
    await vi.waitFor(() => expect(stopScreencast).toHaveBeenCalledOnce());
    const duplicateStop = stopBrowserRecording("recording-tab");

    finishStoppingScreencast?.();
    const [firstArtifact, duplicateArtifact] = await Promise.all([firstStop, duplicateStop]);

    expect(duplicateArtifact).toEqual(firstArtifact);
    expect(stopScreencast).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
  });

  it("finishes startup before stopping so an active recording yields an artifact", async () => {
    let finishStartingScreencast: (() => void) | undefined;
    startScreencast.mockImplementationOnce(async () => {
      events.push("start-screencast");
      await new Promise<void>((resolve) => {
        finishStartingScreencast = resolve;
      });
      emitRecordingFrame();
    });

    const startPromise = startBrowserRecording("recording-tab");
    await vi.waitFor(() => expect(startScreencast).toHaveBeenCalledOnce());

    const stopPromise = stopBrowserRecording("recording-tab");
    expect(stopScreencast).not.toHaveBeenCalled();
    finishStartingScreencast?.();

    await startPromise;
    await expect(stopPromise).resolves.toMatchObject({ tabId: "recording-tab" });
    expect(stopScreencast).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledOnce();
    expect(events.at(-1)).toBe("clear");
  });

  it("does not release the recording slot until a cancelled start settles", async () => {
    let finishStartingScreencast: (() => void) | undefined;
    startScreencast.mockImplementationOnce(async () => {
      events.push("start-screencast");
      await new Promise<void>((resolve) => {
        finishStartingScreencast = resolve;
      });
      emitRecordingFrame();
    });

    const firstStart = startBrowserRecording("recording-tab");
    await vi.waitFor(() => expect(startScreencast).toHaveBeenCalledOnce());

    const stopPromise = stopBrowserRecording("recording-tab");
    const restartAfterStop = stopPromise.then(() => startBrowserRecording("recording-tab"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const startCallsBeforeFirstSettled = startScreencast.mock.calls.length;

    finishStartingScreencast?.();
    await firstStart;
    await stopPromise;
    await restartAfterStop;
    await stopBrowserRecording("recording-tab");

    expect(startCallsBeforeFirstSettled).toBe(1);
  });

  it("keeps the recording slot while a failed stop waits for startup", async () => {
    let finishStartingScreencast: (() => void) | undefined;
    startScreencast.mockImplementationOnce(async () => {
      events.push("start-screencast");
      await new Promise<void>((resolve) => {
        finishStartingScreencast = resolve;
      });
      emitRecordingFrame();
    });
    stopScreencast.mockRejectedValueOnce(new Error("initial stop failed"));

    const firstStart = startBrowserRecording("recording-tab");
    await vi.waitFor(() => expect(startScreencast).toHaveBeenCalledOnce());

    const stopPromise = stopBrowserRecording("recording-tab");
    const rejectedStop = expect(stopPromise).rejects.toMatchObject({
      operation: "stop-screencast",
      tabId: "recording-tab",
    });
    expect(stopScreencast).not.toHaveBeenCalled();
    await expect(startBrowserRecording("recording-tab")).rejects.toBeInstanceOf(
      BrowserRecordingConflictError,
    );

    finishStartingScreencast?.();
    await firstStart;
    await rejectedStop;
    expect(stopScreencast).toHaveBeenCalledOnce();

    await startBrowserRecording("recording-tab");
    await stopBrowserRecording("recording-tab");
  });

  it("fails a stop that waits too long for startup without freeing the recording slot", async () => {
    vi.useFakeTimers();
    let finishStartingScreencast: (() => void) | undefined;
    startScreencast.mockImplementationOnce(async () => {
      events.push("start-screencast");
      await new Promise<void>((resolve) => {
        finishStartingScreencast = resolve;
      });
      emitRecordingFrame();
    });

    const startPromise = startBrowserRecording("recording-tab");
    expect(startScreencast).toHaveBeenCalledOnce();

    const stopPromise = stopBrowserRecording("recording-tab");
    await Promise.resolve();
    await Promise.resolve();
    expect(stopScreencast).not.toHaveBeenCalled();

    const rejection = expect(stopPromise).rejects.toMatchObject({
      operation: "wait-startup",
      tabId: "recording-tab",
    });
    await vi.advanceTimersByTimeAsync(BROWSER_RECORDING_STARTUP_SETTLE_TIMEOUT_MS);

    await rejection;
    expect(save).not.toHaveBeenCalled();
    await expect(startBrowserRecording("recording-tab")).rejects.toBeInstanceOf(
      BrowserRecordingConflictError,
    );

    finishStartingScreencast?.();
    await startPromise;
    const cleanupResult = await stopBrowserRecording("recording-tab");
    expect(cleanupResult).toBeNull();
    expect(stopScreencast).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(events.at(-1)).toBe("clear");
  });
});
