import * as Linking from "expo-linking";
import { memo } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { UNSPLASH_UTM, type SceneryPhoto } from "../scenery/sceneryLogic";
import type { HomeGlanceSummary } from "./home-glance";

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
});

/**
 * Top of the iOS glass Home list: today's date, what needs the user across
 * the cards below, and where today's photo was taken. It scrolls away with
 * the list and is left out while searching.
 */
export const HomeGlance = memo(function HomeGlance(props: {
  readonly summary: HomeGlanceSummary;
  /** Local date being shown; follows the list's minute clock past midnight. */
  readonly date: Date;
  /** Today's photo behind Home, credited here. */
  readonly photo: SceneryPhoto | null;
}) {
  const dateLabel = DATE_FORMATTER.format(props.date);
  const { headline, detail } = props.summary;
  return (
    // Card inset 12 + card padding 16: the text lines up with the card tiles.
    <View className="px-7 pb-3 pt-1">
      <View
        accessible
        accessibilityLabel={[dateLabel, headline, detail].filter(Boolean).join(". ")}
      >
        <Text className="text-2xs font-t3-bold uppercase tracking-[0.8px] text-foreground-secondary">
          {dateLabel}
        </Text>
        <Text
          accessibilityRole="header"
          className="mt-1 text-2xl font-t3-bold tracking-tight text-foreground"
          numberOfLines={2}
        >
          {headline}
        </Text>
        {detail !== null ? (
          <Text className="mt-0.5 text-sm text-foreground-secondary" numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
      </View>
      {props.photo !== null ? <HomeGlancePhotoCredit photo={props.photo} /> : null}
    </View>
  );
});

function HomeGlancePhotoCredit(props: { readonly photo: SceneryPhoto }) {
  const { photo } = props;
  const profileURL =
    photo.photographerProfileURL !== null
      ? `${photo.photographerProfileURL}${UNSPLASH_UTM}`
      : `https://unsplash.com/${UNSPLASH_UTM}`;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`Wallpaper: ${photo.name}. Photo by ${photo.photographerName} on Unsplash.`}
      className="mt-2.5 flex-row items-center gap-1.5 self-start"
      hitSlop={8}
      onPress={() => void Linking.openURL(profileURL).catch(() => undefined)}
      style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
    >
      <SymbolView
        name="photo"
        size={11}
        tintColorClassName="accent-foreground-secondary"
        type="monochrome"
      />
      <Text className="shrink text-2xs text-foreground-secondary" numberOfLines={1}>
        {photo.name} · Photo by {photo.photographerName}
      </Text>
    </Pressable>
  );
}
