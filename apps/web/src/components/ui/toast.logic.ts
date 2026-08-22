import type { ScopedThreadRef, ThreadId } from "@t3tools/contracts";

/**
 * Base UI toast updates omit `undefined` fields, so callers that need to remove
 * an action must pass a defined `actionProps` whose `children` are empty.
 * Treat that payload (and missing children) as "no visible action".
 */
export function hasVisibleToastAction(actionProps: unknown): boolean {
  if (actionProps == null || typeof actionProps !== "object") {
    return false;
  }
  if (!("children" in actionProps)) {
    return false;
  }
  const children = actionProps.children;
  return children != null && children !== false && children !== "";
}

/** Confirmation toasts always leave on their own. Loading / dismissAfterVisibleMs:0 stay. */
export const TOAST_AUTO_DISMISS_MS = {
  success: 5_000,
  info: 6_000,
  warning: 8_000,
  error: 10_000,
} as const;

export function resolveToastAutoDismissMs(input: {
  type?: string | undefined;
  timeout?: number | undefined;
  dismissAfterVisibleMs?: number | undefined;
}): number | undefined {
  if (input.type === "loading" || input.dismissAfterVisibleMs === 0) {
    return undefined;
  }
  if (typeof input.dismissAfterVisibleMs === "number") {
    return input.dismissAfterVisibleMs > 0 ? input.dismissAfterVisibleMs : undefined;
  }
  // Provider timeout is always 0; that is not persist. Only a positive
  // per-toast timeout (before stripToastTimeout) is a duration.
  if (typeof input.timeout === "number" && input.timeout > 0) {
    return input.timeout;
  }
  if (input.type === "error") {
    return TOAST_AUTO_DISMISS_MS.error;
  }
  if (input.type === "warning") {
    return TOAST_AUTO_DISMISS_MS.warning;
  }
  if (input.type === "info") {
    return TOAST_AUTO_DISMISS_MS.info;
  }
  return TOAST_AUTO_DISMISS_MS.success;
}

export function shouldRunToastAutoDismissTimer(
  visibilityState: Document["visibilityState"],
): boolean {
  // Visible is enough. Native menus and Electron chrome steal document
  // focus, which used to freeze Base UI's timer until a manual dismiss.
  return visibilityState === "visible";
}

/**
 * Base UI runs its own dismiss timer for any per-toast `timeout` and pauses it
 * on blur / native menus. Move explicit durations onto `dismissAfterVisibleMs`
 * (and `timeout: 0` onto persist) so ThreadToastVisibleAutoDismiss owns every clock.
 */
export function stripToastTimeout<
  TOptions extends {
    type?: string | undefined;
    timeout?: number | undefined;
    data?: { dismissAfterVisibleMs?: number | undefined } | undefined;
  },
>(options: TOptions): TOptions {
  if (typeof options.timeout !== "number") {
    return options;
  }
  if (options.type === "loading" || options.data?.dismissAfterVisibleMs === 0) {
    return options.timeout > 0 ? { ...options, timeout: 0 } : options;
  }
  if (options.timeout <= 0) {
    if (options.data?.dismissAfterVisibleMs !== undefined) {
      return options;
    }
    return {
      ...options,
      data: {
        ...options.data,
        dismissAfterVisibleMs: 0,
      },
    };
  }
  return {
    ...options,
    timeout: 0,
    data: {
      ...options.data,
      dismissAfterVisibleMs: options.data?.dismissAfterVisibleMs ?? options.timeout,
    },
  };
}

export function shouldHideCollapsedToastContent(
  visibleToastIndex: number,
  visibleToastCount: number,
): boolean {
  // Keep the front-most toast readable even if Base UI marks it as "behind"
  // due to toasts hidden by thread filtering.
  if (visibleToastCount <= 1) return false;
  return visibleToastIndex > 0;
}

type ToastWithHeight = {
  height?: number | null | undefined;
};

type ToastWithTransitionStatus = {
  transitionStatus?: "starting" | "ending" | undefined;
};

type ToastWithLayoutProps = ToastWithHeight & ToastWithTransitionStatus;

type VisibleToastLayoutItem<TToast extends object> = {
  toast: TToast;
  visibleIndex: number;
  offsetY: number;
};

export function buildVisibleToastLayout<TToast extends object>(
  visibleToasts: readonly (TToast & ToastWithLayoutProps)[],
): {
  frontmostHeight: number;
  items: VisibleToastLayoutItem<TToast & ToastWithLayoutProps>[];
} {
  // Two parallel cursors:
  //   - `full*`  advances on every toast, so an ending toast keeps the slot it
  //     occupied before dismissal and its data-ending-style exit transform
  //     originates from the correct position (critical for dismissing a
  //     non-front toast in the expanded stack — otherwise it would snap to
  //     Y=0 and slide off diagonally).
  //   - `live*`  advances only on non-ending toasts, so live toasts reflow
  //     past the vacated slot in parallel with the exit animation instead of
  //     waiting for it to finish (which caused a visible "stop and bump").
  let fullIndex = 0;
  let fullOffsetY = 0;
  let liveIndex = 0;
  let liveOffsetY = 0;

  const items: VisibleToastLayoutItem<TToast & ToastWithLayoutProps>[] = visibleToasts.map(
    (toast) => {
      const height = normalizeToastHeight(toast.height);

      if (toast.transitionStatus === "ending") {
        const item = {
          toast,
          visibleIndex: fullIndex,
          offsetY: fullOffsetY,
        };
        fullOffsetY += height;
        fullIndex += 1;
        return item;
      }

      const item = {
        toast,
        visibleIndex: liveIndex,
        offsetY: liveOffsetY,
      };

      fullOffsetY += height;
      fullIndex += 1;
      liveOffsetY += height;
      liveIndex += 1;
      return item;
    },
  );

  // Frontmost height should reflect the first non-ending (live) toast so the
  // stack sizes to what's actually staying on screen.
  const frontmostLiveToast = visibleToasts.find((toast) => toast.transitionStatus !== "ending");

  return {
    frontmostHeight: normalizeToastHeight(frontmostLiveToast?.height),
    items,
  };
}

function normalizeToastHeight(height: number | null | undefined): number {
  return typeof height === "number" && Number.isFinite(height) && height > 0 ? height : 0;
}

export function shouldRenderThreadScopedToast(
  data:
    | {
        threadRef?: ScopedThreadRef | null;
        threadId?: ThreadId | null;
      }
    | undefined,
  activeThreadRef: ScopedThreadRef | null,
): boolean {
  if (data?.threadRef) {
    return (
      activeThreadRef !== null &&
      data.threadRef.environmentId === activeThreadRef.environmentId &&
      data.threadRef.threadId === activeThreadRef.threadId
    );
  }

  const toastThreadId = data?.threadId;
  if (!toastThreadId) {
    return true;
  }

  return activeThreadRef?.threadId === toastThreadId;
}
