import { createContext, useContext, type ReactNode } from "react";

import {
  NativeWorkspaceInspectorContext,
  NativeWorkspaceModeContext,
} from "../../native/v5-workspace-context";

const InspectorVisibilityContext = createContext(true);

export function useInspectorVisibility(): boolean {
  return useContext(InspectorVisibilityContext);
}

export function InspectorVisibilityProvider(props: {
  readonly children: ReactNode;
  readonly visible: boolean;
}) {
  const parentVisible = useInspectorVisibility();
  const nativeWorkspace = useContext(NativeWorkspaceModeContext);
  const nativeInspector = useContext(NativeWorkspaceInspectorContext);

  // A selected retained mode can still be hidden by the outer inspector.
  // Navigation focus does not describe visibility in a split workspace.
  return (
    <InspectorVisibilityContext
      value={parentVisible && props.visible && (!nativeWorkspace || nativeInspector.visible)}
    >
      {props.children}
    </InspectorVisibilityContext>
  );
}
