import type { EnvironmentId } from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { Platform, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { GroupedCard } from "../scenery/GroupedCard";
import { ConnectionEnvironmentRow } from "./ConnectionEnvironmentRow";

type EnvironmentRowProps = ComponentProps<typeof ConnectionEnvironmentRow>;

/** Shared list and empty state for environment management entry points. */
export function LocalEnvironmentList({
  environments,
  expandedId,
  onToggle,
  ...rowActions
}: Pick<
  EnvironmentRowProps,
  "onReconnect" | "onRemove" | "onSetEnabled" | "onUpdate" | "opensDetails"
> & {
  readonly environments: ReadonlyArray<EnvironmentRowProps["environment"]>;
  readonly expandedId: EnvironmentId | null;
  readonly onToggle: (environmentId: EnvironmentId) => void;
}) {
  if (environments.length === 0) {
    return (
      <GroupedCard
        collapsable={false}
        className={cn(
          Platform.OS === "android" && "rounded-[24px]",
          "items-center gap-3 px-6 py-8",
        )}
      >
        <View className="h-12 w-12 items-center justify-center rounded-[16px] bg-subtle">
          <SymbolView
            name="point.3.connected.trianglepath.dotted"
            size={20}
            tintColorClassName="accent-icon-muted"
            type="monochrome"
          />
        </View>
        <Text className="text-center text-sm leading-normal text-foreground-muted">
          No environments connected yet.{"\n"}Tap{" "}
          <Text className="font-t3-bold text-foreground">+</Text> to add one.
        </Text>
      </GroupedCard>
    );
  }

  return (
    <GroupedCard collapsable={false} className={cn(Platform.OS === "android" && "rounded-[24px]")}>
      {environments.map((environment) => (
        <View key={environment.environmentId} collapsable={false}>
          <ConnectionEnvironmentRow
            environment={environment}
            expanded={expandedId === environment.environmentId}
            onToggle={() => onToggle(environment.environmentId)}
            {...rowActions}
          />
        </View>
      ))}
    </GroupedCard>
  );
}
