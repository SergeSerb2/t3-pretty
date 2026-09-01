import { SymbolView } from "../components/AppSymbol";
import { videoMimeType } from "@t3tools/shared/video";
import { useEffect, useRef, useState } from "react";
import { Alert, Image, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { AppText as Text } from "./AppText";
import type { DraftComposerAttachment, DraftComposerFileAttachment } from "../lib/composerImages";
import { VideoAttachmentTile } from "./VideoAttachmentTile";
import { loadLocalVideoPreview } from "../lib/localVideoPreview";

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
  readonly onPressVideo?: (
    attachment: DraftComposerFileAttachment,
    sourceIdentifier: string,
  ) => void;
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

export function ComposerAttachmentThumbnail(props: {
  readonly attachment: DraftComposerAttachment;
  readonly size: number;
  readonly borderRadius: number;
  readonly compact?: boolean;
  readonly preparing?: boolean;
  readonly onPressImage?: (previewUri: string) => void;
  readonly onPressVideo?: (
    attachment: DraftComposerFileAttachment,
    sourceIdentifier: string,
  ) => void;
}) {
  const { attachment } = props;
  const preparing = props.preparing === true;
  const style = { width: props.size, height: props.size, borderRadius: props.borderRadius };
  if (attachment.type === "image") {
    return (
      <ComposerAttachmentThumb
        previewUri={attachment.previewUri}
        size={props.size}
        borderRadius={props.borderRadius}
        preparing={preparing}
        onPress={
          props.onPressImage && !preparing
            ? () => props.onPressImage?.(attachment.previewUri)
            : undefined
        }
      />
    );
  }

  const onPressVideo = props.onPressVideo;
  const content =
    onPressVideo && videoMimeType(attachment) !== null ? (
      <ComposerVideoAttachment
        {...props}
        attachment={attachment}
        preparing={preparing}
        onPressVideo={onPressVideo}
      />
    ) : (
      <View
        accessible={!preparing}
        accessibilityLabel={`File attachment, ${attachment.name}`}
        className={
          props.compact
            ? "items-center justify-center bg-subtle"
            : "items-center justify-center gap-1 bg-subtle px-2"
        }
        style={style}
      >
        <SymbolView
          name="doc.text"
          size={props.compact ? 15 : 22}
          tintColor="#a3a3a3"
          type="monochrome"
        />
        {!props.compact ? (
          <Text className="w-full text-center text-2xs text-foreground" numberOfLines={1}>
            {attachment.name}
          </Text>
        ) : null}
      </View>
    );

  if (!preparing) {
    return content;
  }

  return (
    <View
      accessible
      accessibilityLabel={`Preparing file attachment, ${attachment.name}`}
      pointerEvents="none"
      style={style}
    >
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {content}
      </View>
      <Animated.View
        entering={OVERLAY_ENTER}
        exiting={OVERLAY_EXIT}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="absolute inset-0 bg-black/45"
        style={{ borderRadius: props.borderRadius }}
      />
    </View>
  );
}

function ComposerVideoAttachment(props: {
  readonly attachment: DraftComposerFileAttachment;
  readonly size: number;
  readonly borderRadius: number;
  readonly compact?: boolean;
  readonly preparing?: boolean;
  readonly onPressVideo: (
    attachment: DraftComposerFileAttachment,
    sourceIdentifier: string,
  ) => void;
}) {
  const { attachment } = props;
  const sourceIdentifier = `draft:${attachment.id}`;
  const style = { width: props.size, height: props.size, borderRadius: props.borderRadius };
  const shareRef = useRef<AbortController | null>(null);
  const [sharing, setSharing] = useState(false);
  useEffect(
    () => () => {
      shareRef.current?.abort();
      shareRef.current = null;
    },
    [],
  );

  const onShare = () => {
    if (shareRef.current || props.preparing === true) return;
    const controller = new AbortController();
    shareRef.current = controller;
    setSharing(true);
    void (async () => {
      const preview = await loadLocalVideoPreview(attachment, controller.signal);
      if (!preview) return;
      try {
        await preview.share(controller.signal, sourceIdentifier);
      } finally {
        preview.dispose();
      }
    })()
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          Alert.alert(
            "Could not share video",
            error instanceof Error ? error.message : "Try again.",
          );
        }
      })
      .finally(() => {
        if (shareRef.current === controller) {
          shareRef.current = null;
          setSharing(false);
        }
      });
  };

  return (
    <VideoAttachmentTile
      name={attachment.name}
      sourceIdentifier={sourceIdentifier}
      thumbnailSource={attachment}
      compact={props.compact}
      onPress={() => props.onPressVideo(attachment, sourceIdentifier)}
      onShare={onShare}
      disabled={sharing || props.preparing === true}
      style={style}
    />
  );
}

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
              <ComposerAttachmentThumbnail
                attachment={attachment}
                size={size}
                borderRadius={radius}
                preparing={preparing}
                onPressImage={props.onPressImage}
                onPressVideo={props.onPressVideo}
              />
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
