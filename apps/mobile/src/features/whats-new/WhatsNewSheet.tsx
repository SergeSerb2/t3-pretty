import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import type { ChangelogRelease } from "./changelogData";
import {
  formatUpdateSubtitle,
  presentChangelogHistory,
  presentUpdateDigest,
  type PresentedKindGroup,
} from "./changelogPresentation";

function KindGroupList(props: { readonly groups: readonly PresentedKindGroup[] }) {
  const showHeadings = props.groups.length > 1;
  return (
    <View className="gap-6">
      {props.groups.map((group) => (
        <View key={group.kind} className="gap-3">
          {showHeadings ? (
            <Text className="text-sm font-t3-medium text-foreground-muted">{group.heading}</Text>
          ) : null}
          <View className="gap-3.5">
            {group.items.map((item) => (
              <View key={item.title} className="gap-0.5">
                <Text className="text-base font-t3-medium text-foreground">{item.title}</Text>
                {item.description ? (
                  <Text className="text-sm leading-5 text-foreground-secondary">
                    {item.description}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export function WhatsNewSheet(props: {
  readonly open: boolean;
  readonly releases: readonly ChangelogRelease[];
  readonly announceUpdate: boolean;
  readonly currentVersion: string;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const nativeTheme = useUniwindTheme();
  const pressedOverlay = String(nativeTheme["--color-subtle"]);
  const digest = props.announceUpdate ? presentUpdateDigest(props.releases) : null;
  const history = props.announceUpdate ? null : presentChangelogHistory(props.releases);

  return (
    <Modal
      visible={props.open}
      transparent
      animationType="slide"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={props.onClose}
    >
      <View className="flex-1 justify-end bg-backdrop">
        <View
          accessibilityViewIsModal
          className="max-h-[82%] rounded-t-[28px] bg-sheet px-6 pt-6"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <Text className="text-2xl font-t3-bold text-foreground">What's new</Text>
          <Text className="mt-1 text-sm text-foreground-muted">
            {props.announceUpdate
              ? formatUpdateSubtitle(props.releases, props.currentVersion)
              : "Recent updates"}
          </Text>
          <ScrollView className="mt-5" showsVerticalScrollIndicator={false}>
            {digest && digest.groups.length === 0 ? (
              <Text className="pb-2 text-sm leading-5 text-foreground-muted">
                This update is installed. There are no extra notes to show.
              </Text>
            ) : digest ? (
              <View className="gap-5 pb-2">
                {digest.headline ? (
                  <Text className="text-base leading-6 text-foreground">{digest.headline}</Text>
                ) : null}
                <KindGroupList groups={digest.groups} />
                {digest.truncated ? (
                  <Text className="text-sm leading-5 text-foreground-muted">
                    Earlier changes are in Settings.
                  </Text>
                ) : null}
              </View>
            ) : history !== null && history.length === 0 ? (
              <Text className="pb-2 text-sm leading-5 text-foreground-muted">
                No recent notes to show.
              </Text>
            ) : (
              <View className="pb-2">
                {history?.map((day, index) => (
                  <View
                    key={day.date}
                    className={index > 0 ? "mt-5 border-t border-border pt-5" : undefined}
                  >
                    <Text className="mb-4 text-sm font-t3-medium text-foreground">{day.label}</Text>
                    <KindGroupList groups={day.groups} />
                  </View>
                ))}
              </View>
            )}
          </ScrollView>
          <View className="mt-2 overflow-hidden rounded-full">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={props.announceUpdate ? "Continue" : "Close"}
              className="min-h-12 items-center justify-center bg-primary"
              android_ripple={{ color: pressedOverlay }}
              onPress={props.onClose}
            >
              <Text className="text-base font-t3-bold text-primary-foreground">
                {props.announceUpdate ? "Continue" : "Close"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
