import { SymbolView } from "../components/AppSymbol";
import { Image, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { AppText as Text } from "./AppText";
import type { DraftComposerAttachment } from "../lib/composerImages";

export type ComposerAttachmentPreview = DraftComposerAttachment & {
  /** True while the attachment is still being read or the message is sending. */
  readonly preparing?: boolean;
};

export interface ComposerAttachmentStripProps {
  /** Attachments to display. */
  readonly attachments: ReadonlyArray<ComposerAttachmentPreview>;
  /** Called when the user removes an attachment. */
  readonly onRemove: (imageId: string) => void;
  /** Called when the user taps on an image thumbnail to preview it. */
  readonly onPressImage?: (previewUri: string) => void;
  /** Image thumbnail size in points.  Defaults to 72. */
  readonly imageSize?: number;
  /** Border radius of each image thumbnail.  Defaults to 16. */
  readonly imageBorderRadius?: number;
  /** Whether the remove button should sit in its own gutter instead of overlapping the image. */
  readonly removeButtonPlacement?: "overlay" | "gutter";
  /** Dim every thumbnail and hide remove — used while the turn is sending. */
  readonly busy?: boolean;
}

const OVERLAY_ENTER = FadeIn.duration(160).reduceMotion(ReduceMotion.System);
const OVERLAY_EXIT = FadeOut.duration(120).reduceMotion(ReduceMotion.System);

/**
 * Attachment thumbnails used by the thread composer and the new-task draft screen.
 */
export function ComposerAttachmentStrip(props: ComposerAttachmentStripProps) {
  const size = props.imageSize ?? 72;
  const radius = props.imageBorderRadius ?? 16;
  const removeButtonPlacement = props.removeButtonPlacement ?? "overlay";
  const removeButtonGutter = removeButtonPlacement === "gutter" ? 10 : 0;
  const busy = props.busy === true;

  if (props.attachments.length === 0) {
    return null;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      className="grow-0"
    >
      <View className="flex-row gap-2.5">
        {props.attachments.map((attachment) => {
          const preparing = busy || attachment.preparing === true;
          return (
            <View
              key={attachment.id}
              className="relative"
              style={{
                paddingTop: removeButtonGutter,
                paddingRight: removeButtonGutter,
              }}
            >
              {attachment.type === "image" ? (
                <ComposerAttachmentThumb
                  previewUri={attachment.previewUri}
                  size={size}
                  borderRadius={radius}
                  preparing={preparing}
                  onPress={
                    props.onPressImage && !preparing
                      ? () => props.onPressImage!(attachment.previewUri)
                      : undefined
                  }
                />
              ) : (
                <View
                  accessible
                  accessibilityLabel={
                    preparing
                      ? `Preparing file attachment, ${attachment.name}`
                      : `File attachment, ${attachment.name}`
                  }
                  className="items-center justify-center gap-1 bg-subtle px-2"
                  style={{
                    width: size,
                    height: size,
                    borderRadius: radius,
                  }}
                >
                  <SymbolView name="doc.text" size={22} tintColor="#a3a3a3" type="monochrome" />
                  <Text className="w-full text-center text-2xs text-foreground" numberOfLines={1}>
                    {attachment.name}
                  </Text>
                  {preparing ? (
                    <Animated.View
                      entering={OVERLAY_ENTER}
                      exiting={OVERLAY_EXIT}
                      pointerEvents="none"
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      className="absolute inset-0 bg-black/45"
                      style={{ borderRadius: radius }}
                    />
                  ) : null}
                </View>
              )}
              {preparing ? null : (
                <Pressable
                  className="absolute h-[22px] w-[22px] items-center justify-center rounded-[11px] bg-black/55"
                  style={{
                    top: removeButtonPlacement === "gutter" ? 0 : 4,
                    right: removeButtonPlacement === "gutter" ? 0 : 4,
                  }}
                  hitSlop={6}
                  accessibilityLabel="Remove attachment"
                  accessibilityRole="button"
                  onPress={() => props.onRemove(attachment.id)}
                >
                  <SymbolView
                    name="xmark"
                    size={9}
                    tintColor="#ffffff"
                    type="monochrome"
                    weight="bold"
                  />
                </Pressable>
              )}
            </View>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function ComposerAttachmentThumb(props: {
  readonly previewUri: string;
  readonly size: number;
  readonly borderRadius: number;
  readonly preparing?: boolean;
  readonly onPress?: () => void;
}) {
  const accessibilityLabel = props.preparing
    ? "Preparing image attachment"
    : props.onPress
      ? "Preview image attachment"
      : "Image attachment";
  const image = (
    <View
      accessible={!props.onPress}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={!props.onPress ? "image" : undefined}
      style={{ width: props.size, height: props.size }}
    >
      <Image
        accessible={false}
        source={{ uri: props.previewUri }}
        className="bg-subtle"
        style={{
          width: props.size,
          height: props.size,
          borderRadius: props.borderRadius,
        }}
        resizeMode="cover"
      />
      {props.preparing ? (
        <Animated.View
          entering={OVERLAY_ENTER}
          exiting={OVERLAY_EXIT}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          className="absolute inset-0 bg-black/45"
          style={{ borderRadius: props.borderRadius }}
        />
      ) : null}
    </View>
  );

  if (!props.onPress) {
    return image;
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
      onPress={props.onPress}
    >
      {image}
    </Pressable>
  );
}

export function ComposerDispatchStatusLabel(props: { readonly label: string }) {
  return (
    <Animated.View
      entering={OVERLAY_ENTER}
      exiting={OVERLAY_EXIT}
      accessibilityLiveRegion="polite"
      accessibilityRole="text"
    >
      <Text className="pt-2 text-xs text-foreground-muted">{props.label}</Text>
    </Animated.View>
  );
}
