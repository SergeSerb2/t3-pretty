import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";

import { RenderErrorBoundary, RenderFailureView } from "../../components/RenderErrorBoundary";

export type ThreadInspectorMode = "route" | "git" | "files";

const ThreadInspectorVisibilityContext = createContext(true);

export function useThreadInspectorVisibility(): boolean {
  return useContext(ThreadInspectorVisibilityContext);
}

function InspectorContentPane(props: {
  readonly children: ReactNode;
  readonly mounted: boolean;
  readonly resetKeys: readonly [string | null, string | null];
  readonly visible: boolean;
}) {
  if (!props.mounted) {
    return null;
  }

  return (
    <ThreadInspectorVisibilityContext.Provider value={props.visible}>
      <View
        accessibilityElementsHidden={!props.visible}
        focusable={props.visible}
        importantForAccessibility={props.visible ? "auto" : "no-hide-descendants"}
        pointerEvents={props.visible ? "auto" : "none"}
        style={{
          position: "absolute",
          inset: 0,
          opacity: props.visible ? 1 : 0,
          zIndex: props.visible ? 1 : 0,
        }}
      >
        <RenderErrorBoundary
          resetKeys={props.resetKeys}
          renderFallback={(fallback) => (
            <RenderFailureView {...fallback} title="The inspector couldn't be displayed" />
          )}
        >
          {props.children}
        </RenderErrorBoundary>
      </View>
    </ThreadInspectorVisibilityContext.Provider>
  );
}

export function ThreadInspectorContentStack(
  props: {
    readonly mode: ThreadInspectorMode;
    readonly resetKeys: readonly [string | null, string | null];
  } & (
    | {
        // Retain the fork's node API: live thread updates must not remount
        // a retained pane by replacing its component type.
        readonly files: ReactNode;
        readonly git: ReactNode;
        readonly route?: ReactNode;
        readonly renderFiles?: never;
        readonly renderGit?: never;
        readonly renderRoute?: never;
      }
    | {
        readonly files?: never;
        readonly git?: never;
        readonly route?: never;
        readonly renderFiles: () => ReactNode;
        readonly renderGit?: () => ReactNode;
        readonly renderRoute?: () => ReactNode;
      }
  ),
) {
  const [mountedModes, setMountedModes] = useState<ReadonlySet<ThreadInspectorMode>>(
    () => new Set([props.mode]),
  );

  useEffect(() => {
    // Mount each inspector on first use and retain it so UIKit does not rebuild
    // the file tree's focus graph on later switches.
    setMountedModes((current) => {
      if (current.has(props.mode)) {
        return current;
      }
      return new Set([...current, props.mode]);
    });
  }, [props.mode]);

  return (
    <View className="flex-1">
      <InspectorContentPane
        mounted={mountedModes.has("files") || props.mode === "files"}
        resetKeys={props.resetKeys}
        visible={props.mode === "files"}
      >
        {props.renderFiles ? (
          <InspectorRenderer render={props.renderFiles} />
        ) : (
          props.files
        )}
      </InspectorContentPane>
      {props.renderGit !== undefined || "git" in props ? (
        <InspectorContentPane
          mounted={mountedModes.has("git") || props.mode === "git"}
          resetKeys={props.resetKeys}
          visible={props.mode === "git"}
        >
          {props.renderGit ? (
            <InspectorRenderer render={props.renderGit} />
          ) : (
            props.git
          )}
        </InspectorContentPane>
      ) : null}
      {props.route !== undefined || props.renderRoute !== undefined ? (
        <InspectorContentPane
          mounted={mountedModes.has("route") || props.mode === "route"}
          resetKeys={props.resetKeys}
          visible={props.mode === "route"}
        >
          {props.renderRoute ? (
            <InspectorRenderer render={props.renderRoute} />
          ) : (
            props.route
          )}
        </InspectorContentPane>
      ) : null}
    </View>
  );
}

// Render callbacks carry changing route data; they are not component types.
function InspectorRenderer(props: { readonly render: () => ReactNode }) {
  return <>{props.render()}</>;
}
