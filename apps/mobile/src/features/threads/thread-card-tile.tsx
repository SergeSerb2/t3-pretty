import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { Image } from "expo-image";
import { memo } from "react";
import { StyleSheet, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { ProjectFavicon } from "../../components/ProjectFavicon";

const TILE_SIZE = 40;
const BADGE_SIZE = 18;

/**
 * Leading tile of a glass Home card. A thread with scenery shows that photo,
 * the one behind it on the thread screen, with the project icon as a corner
 * badge; otherwise the project icon fills the tile.
 */
export const ThreadCardTile = memo(function ThreadCardTile(props: {
  readonly environmentId: EnvironmentId;
  readonly project: EnvironmentProject | null;
  readonly photoURL: string | null;
}) {
  const { project, photoURL } = props;
  const favicon = (size: number) =>
    project ? (
      <ProjectFavicon
        environmentId={props.environmentId}
        faviconPath={project.faviconPath}
        projectIcon={project.projectIcon}
        projectTitle={project.title}
        size={size}
        workspaceRoot={project.workspaceRoot}
      />
    ) : null;
  return (
    <View importantForAccessibility="no-hide-descendants" style={styles.frame}>
      <View
        className="items-center justify-center border-chrome-glass-border bg-foreground/5"
        style={styles.tile}
      >
        {photoURL !== null ? (
          <Image
            cachePolicy="memory-disk"
            contentFit="cover"
            recyclingKey={photoURL}
            source={{ uri: photoURL }}
            style={StyleSheet.absoluteFill}
            transition={150}
          />
        ) : (
          (favicon(22) ?? (
            <SymbolView
              name="text.bubble"
              size={18}
              tintColorClassName="accent-foreground-muted"
              type="monochrome"
            />
          ))
        )}
      </View>
      {photoURL !== null && project ? (
        <View
          className="items-center justify-center border-chrome-glass-border bg-screen"
          style={styles.badge}
        >
          {favicon(14)}
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  frame: { height: TILE_SIZE, width: TILE_SIZE },
  tile: {
    borderCurve: "continuous",
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    height: TILE_SIZE,
    overflow: "hidden",
    width: TILE_SIZE,
  },
  badge: {
    borderCurve: "continuous",
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    bottom: -4,
    height: BADGE_SIZE,
    position: "absolute",
    right: -4,
    width: BADGE_SIZE,
  },
});
