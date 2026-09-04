import { Component, type ReactNode } from "react";

export function renderErrorBoundaryResetKeysChanged(
  previous: readonly unknown[] | undefined,
  next: readonly unknown[] | undefined,
): boolean {
  if (previous === next) return false;
  if (previous === undefined || next === undefined || previous.length !== next.length) return true;
  return previous.some((value, index) => !Object.is(value, next[index]));
}

interface RenderErrorBoundaryProps {
  readonly children: ReactNode;
  readonly fallback: ReactNode;
  /** Retry rendering after the failed content's identity changes. */
  readonly resetKeys?: readonly unknown[];
}

interface RenderErrorBoundaryState {
  readonly failed: boolean;
  readonly resetKeys: readonly unknown[] | undefined;
}

export class RenderErrorBoundary extends Component<
  RenderErrorBoundaryProps,
  RenderErrorBoundaryState
> {
  override state: RenderErrorBoundaryState = {
    failed: false,
    resetKeys: this.props.resetKeys,
  };

  static getDerivedStateFromProps(
    props: Readonly<RenderErrorBoundaryProps>,
    state: Readonly<RenderErrorBoundaryState>,
  ): Partial<RenderErrorBoundaryState> | null {
    if (!renderErrorBoundaryResetKeysChanged(state.resetKeys, props.resetKeys)) {
      return null;
    }
    return { failed: false, resetKeys: props.resetKeys };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
