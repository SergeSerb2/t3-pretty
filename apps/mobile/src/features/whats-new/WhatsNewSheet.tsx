import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";
import type { ChangelogItemKind, ChangelogRelease } from "./changelogData";

const KIND_LABELS: Record<ChangelogItemKind, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
};

function KindBadge(props: { readonly kind: ChangelogItemKind }) {
  return (
    <View className="mt-0.5 w-[74px] items-center rounded-full bg-subtle-strong px-2 py-1">
      <Text className="text-3xs font-t3-bold tracking-[0.9px] uppercase text-foreground-secondary">
        {KIND_LABELS[props.kind]}
      </Text>
    </View>
  );
}

export function WhatsNewSheet(props: {
  readonly open: boolean;
  readonly releases: readonly ChangelogRelease[];
  readonly announceUpdate: boolean;
  readonly onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const pressedOverlay = useThemeColor("--color-subtle");

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
          className="max-h-[82%] rounded-t-[28px] bg-sheet px-6 pt-6"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <Text className="text-2xl font-t3-bold text-foreground">
            {props.announceUpdate ? "What's new" : "Release notes"}
          </Text>
          <Text className="mt-1 text-sm text-foreground-muted">
            {props.announceUpdate
              ? "T3 Pretty updated while you were away."
              : "Everything that shipped recently."}
          </Text>
          <ScrollView className="mt-4" showsVerticalScrollIndicator={false}>
            {props.releases.map((release) => (
              <View key={release.version} className="mb-6">
                <View className="flex-row items-baseline gap-2">
                  <Text className="text-lg font-t3-bold text-foreground">
                    {release.headline ?? `Version ${release.version}`}
                  </Text>
                  <Text className="text-xs text-foreground-tertiary">{release.version}</Text>
                </View>
                <View className="mt-3 gap-4">
                  {release.items.map((item) => (
                    <View key={item.title} className="flex-row gap-3">
                      <KindBadge kind={item.kind} />
                      <View className="flex-1 gap-0.5">
                        <Text className="text-base font-t3-medium text-foreground">
                          {item.title}
                        </Text>
                        {item.description ? (
                          <Text className="text-sm leading-5 text-foreground-secondary">
                            {item.description}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
          <View className="mt-2 overflow-hidden rounded-full">
            <Pressable
              accessibilityRole="button"
              className="min-h-12 items-center justify-center bg-primary"
              android_ripple={{ color: pressedOverlay }}
              onPress={props.onClose}
            >
              <Text className="text-base font-t3-bold text-primary-foreground">Done</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
