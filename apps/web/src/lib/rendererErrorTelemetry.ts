export type RendererErrorSource = "window-error" | "unhandled-rejection" | "render-error";

export function describeRendererError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message.length > 0 ? error.message : error.name,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  if (typeof error === "string" && error.length > 0) return { message: error };
  return { message: "Unknown renderer error" };
}

export function reportRendererError(source: RendererErrorSource, error: unknown): void {
  const described = describeRendererError(error);
  try {
    void window.desktopBridge?.reportRendererError?.({
      source,
      message: described.message.slice(0, 2_048),
      ...(described.stack === undefined ? {} : { stack: described.stack.slice(0, 4_096) }),
    });
  } catch {
    // The desktop bridge is optional; the console breadcrumb still lands.
  }
  console.error(`[t3-renderer-error] ${source}: ${described.message}`);
}

export function installRendererErrorTelemetry(target: Window): () => void {
  const onError = (event: ErrorEvent) => {
    reportRendererError("window-error", event.error ?? event.message);
  };
  const onRejection = (event: PromiseRejectionEvent) => {
    reportRendererError("unhandled-rejection", event.reason);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}
