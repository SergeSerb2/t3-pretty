import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";

export type ThreadInspectorMode = "route" | "git" | "files";

const ThreadInspectorVisibilityContext = createContext(true);

export function useThreadInspectorVisibility(): boolean {
  return useContext(ThreadInspectorVisibilityContext);
}

function InspectorContentPane(props: {
  readonly children: ReactNode;
  readonly mounted: boolean;
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
        {props.children}
      </View>
    </ThreadInspectorVisibilityContext.Provider>
  );
}

export function ThreadInspectorContentStack(props: {
  // Keep these as nodes, not callback component types: live thread props can
  // replace a renderer closure without remounting the retained pane beneath it.
  readonly files: ReactNode;
  readonly git: ReactNode;
  readonly mode: ThreadInspectorMode;
  readonly route?: ReactNode;
}) {
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
        visible={props.mode === "files"}
      >
        {props.files}
      </InspectorContentPane>
      <InspectorContentPane
        mounted={mountedModes.has("git") || props.mode === "git"}
        visible={props.mode === "git"}
      >
        {props.git}
      </InspectorContentPane>
      {props.route !== undefined ? (
        <InspectorContentPane
          mounted={mountedModes.has("route") || props.mode === "route"}
          visible={props.mode === "route"}
        >
          {props.route}
        </InspectorContentPane>
      ) : null}
    </View>
  );
}
