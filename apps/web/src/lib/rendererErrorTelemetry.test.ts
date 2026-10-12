import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  describeRendererError,
  installRendererErrorTelemetry,
  reportRendererError,
} from "./rendererErrorTelemetry";

describe("renderer error telemetry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("describes Error and string values", () => {
    expect(describeRendererError(new Error("timeline crashed"))).toMatchObject({
      message: "timeline crashed",
    });
    expect(describeRendererError("bare string")).toEqual({ message: "bare string" });
  });

  it("forwards window errors to the desktop bridge", () => {
    const reportRendererErrorBridge = vi.fn();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", {
      desktopBridge: { reportRendererError: reportRendererErrorBridge },
    });

    reportRendererError("render-error", new Error("blank after sync"));

    expect(reportRendererErrorBridge).toHaveBeenCalledWith({
      source: "render-error",
      message: "blank after sync",
      stack: expect.stringContaining("blank after sync"),
    });
    expect(consoleError).toHaveBeenCalled();
  });

  it("installs window error and unhandledrejection listeners", () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener: (type: string, listener: EventListener) => {
        listeners.set(type, listener);
      },
      removeEventListener: (type: string) => {
        listeners.delete(type);
      },
    } as unknown as Window;
    const reportRendererErrorBridge = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", {
      desktopBridge: { reportRendererError: reportRendererErrorBridge },
    });

    const uninstall = installRendererErrorTelemetry(target);
    listeners.get("error")?.({
      error: undefined,
      message: "window boom",
    } as ErrorEvent);
    listeners.get("unhandledrejection")?.({
      reason: new Error("rejected"),
    } as PromiseRejectionEvent);

    expect(reportRendererErrorBridge).toHaveBeenCalledWith(
      expect.objectContaining({ source: "window-error", message: "window boom" }),
    );
    expect(reportRendererErrorBridge).toHaveBeenCalledWith(
      expect.objectContaining({ source: "unhandled-rejection", message: "rejected" }),
    );
    uninstall();
    expect(listeners.size).toBe(0);
  });
});
