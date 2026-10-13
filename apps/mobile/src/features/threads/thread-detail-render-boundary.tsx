import { memo, type ReactNode } from "react";

export const ThreadDetailRenderBoundary = memo(
  function ThreadDetailRenderBoundary(props: {
    readonly children: ReactNode;
    readonly threadKey: string;
    readonly visible: boolean;
  }) {
    return props.children;
  },
  (previous, next) =>
    previous.threadKey === next.threadKey &&
    ((!previous.visible && !next.visible) ||
      (previous.visible === next.visible && previous.children === next.children)),
);
