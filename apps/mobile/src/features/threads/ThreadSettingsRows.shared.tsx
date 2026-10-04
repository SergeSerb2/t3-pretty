import type { ReactNode } from "react";
import { Pressable, View } from "react-native";
import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import { cn } from "../../lib/cn";
import type { ModelOption } from "../../lib/modelOptions";
import { useGlassChromeActive } from "../scenery/SceneryProvider";
import { GLASS_CARD_CLASS_NAME, GlassRowPressable, glassCardStyle } from "../scenery/GroupedCard";

export type ModelRowProps = {
  readonly option: ModelOption;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly isFavorite: boolean;
  readonly favoritesLoaded: boolean;
  readonly onToggleFavorite: () => void;
  readonly isFirst: boolean;
  readonly isLast: boolean;
};

export type ChoiceRowProps = {
  readonly label: string;
  readonly description?: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly isLast: boolean;
};

type RowSelectionProps = {
  readonly leadingSelection?: ReactNode;
  readonly trailingSelection?: ReactNode;
  readonly minimumHeight?: number;
};

export function ModelRowContent(
  props: ModelRowProps &
    RowSelectionProps & {
      readonly labelNumberOfLines: number;
      readonly selectedClassName?: string;
    },
) {
  const glass = useGlassChromeActive();
  const row = (
    <View
      style={props.minimumHeight === undefined ? undefined : { minHeight: props.minimumHeight }}
      className={
        // List cells cannot share a GroupedCard, so on glass each row carries
        // its slice of the card (see the wrapper below) and paints no fill.
        glass
          ? cn(
              "min-h-11 flex-row items-center gap-2 pr-4",
              !props.isLast && "border-b border-border-subtle",
            )
          : cn(
              "mx-4 min-h-11 flex-row items-center gap-2 bg-grouped-card px-4",
              props.selectedClassName,
              props.isFirst && "rounded-t-2xl",
              props.isLast ? "rounded-b-2xl" : "border-b border-border-subtle",
            )
      }
    >
      <GlassRowPressable
        accessibilityLabel={[props.option.label, props.option.subtitle].filter(Boolean).join(", ")}
        accessibilityRole="radio"
        accessibilityState={{
          checked: props.selected,
          disabled: props.option.isUnavailable === true,
        }}
        className={cn("min-h-11 min-w-0 flex-1 flex-row items-center gap-2", glass && "pl-4")}
        fallbackClassName="active:opacity-70"
        disabled={props.option.isUnavailable}
        onPress={props.onPress}
      >
        {props.leadingSelection}
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-2">
            <Text
              className="min-w-0 shrink text-base font-t3-medium text-foreground"
              numberOfLines={props.labelNumberOfLines}
            >
              {props.option.label}
            </Text>
            {props.option.isDefault ? (
              <View className="rounded-md bg-subtle-strong px-1.5 py-0.5">
                <Text className="text-3xs font-t3-bold text-foreground-muted">Default</Text>
              </View>
            ) : null}
            {props.option.isLegacy ? (
              <View className="rounded-md bg-subtle px-1.5 py-0.5">
                <Text className="text-3xs font-t3-bold text-foreground-muted">Legacy</Text>
              </View>
            ) : null}
            {props.option.isUnavailable ? (
              <Text className="text-xs text-foreground">Unavailable</Text>
            ) : null}
          </View>
          {props.option.subtitle ? (
            <Text
              className="text-xs text-foreground-muted"
              numberOfLines={props.labelNumberOfLines}
            >
              {props.option.subtitle}
            </Text>
          ) : null}
        </View>
        {props.trailingSelection}
      </GlassRowPressable>
      <Pressable
        accessibilityLabel={`${props.isFavorite ? "Remove from" : "Add to"} favorites: ${
          props.option.providerLabel
        }, ${props.option.label}`}
        accessibilityRole="button"
        accessibilityState={{ disabled: !props.favoritesLoaded, selected: props.isFavorite }}
        className="min-h-11 min-w-11 items-center justify-center"
        disabled={!props.favoritesLoaded}
        onPress={props.onToggleFavorite}
      >
        <SymbolView
          name={props.isFavorite ? "star.fill" : "star"}
          size={18}
          tintColorClassName={props.isFavorite ? "accent-icon" : "accent-icon-subtle"}
          type="monochrome"
        />
      </Pressable>
    </View>
  );
  return glass ? (
    <View
      className={cn(GLASS_CARD_CLASS_NAME, "mx-4")}
      style={glassCardStyle(props.isFirst, props.isLast)}
    >
      {row}
    </View>
  ) : (
    row
  );
}

/** Single option inside a submenu panel. */
export function ChoiceRowContent(props: ChoiceRowProps & RowSelectionProps) {
  const glass = useGlassChromeActive();
  return (
    <GlassRowPressable
      accessibilityLabel={props.description ? `${props.label}. ${props.description}` : props.label}
      accessibilityRole="radio"
      accessibilityState={{ checked: props.selected }}
      onPress={props.onPress}
      style={props.minimumHeight === undefined ? undefined : { minHeight: props.minimumHeight }}
      className={cn(
        "min-h-14 flex-row items-center gap-3 px-4 py-3",
        !glass && "bg-grouped-card",
        !props.isLast && "border-b border-border-subtle",
      )}
      fallbackClassName="active:bg-subtle"
    >
      {props.leadingSelection}
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-base font-t3-medium text-foreground">{props.label}</Text>
        {props.description ? (
          <Text className="text-sm leading-5 text-foreground-muted">{props.description}</Text>
        ) : null}
      </View>
      {props.trailingSelection}
    </GlassRowPressable>
  );
}
