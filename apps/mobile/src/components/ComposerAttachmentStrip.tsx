import { SymbolView } from "../components/AppSymbol";
import { videoMimeType } from "@t3tools/shared/video";
import { useEffect, useMemo, useState } from "react";
import { Image, Pressable, ScrollView, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import { AppText as Text } from "./AppText";
import {
  isFileBackedComposerAttachment,
  type DraftComposerAttachment,
  type DraftComposerFileAttachment,
  type DraftComposerImageAttachment,
} from "../lib/composerImages";
import { resolveOwnedComposerAttachmentFileUri } from "../lib/composerAttachmentFiles";
import { VideoAttachmentTile } from "./VideoAttachmentTile";

import type { MediaActionsSource } from "../lib/mediaActions";
import { PresentationSource } from "./NativePresentation";
import type { FilePreviewSource } from "./FilePreviewModal";
import { isPdfFile } from "../lib/filePreview";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  retryComposerAttachmentUpload,
  useComposerAttachmentUploadState,
} from "../state/composer-attachment-uploads";

export type ComposerAttachmentPreview = DraftComposerAttachment & {
  /** True while the attachment is still being read or the message is sending. */
  readonly preparing?: boolean;
};

export interface ComposerAttachmentStripProps {
  readonly environmentId?: EnvironmentId;
  readonly onPressPreview?: (source: FilePreviewSource) => void;
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

type ComposerAttachmentThumbnailProps = {
  readonly environmentId?: EnvironmentId;
  readonly attachment: DraftComposerAttachment;
  readonly size: number;
  readonly borderRadius: number;
  readonly compact?: boolean;
  readonly preparing?: boolean;
  readonly onPressImage?: (previewUri: string) => void;
  readonly onPressPreview?: (source: FilePreviewSource) => void;
  readonly onPressVideo?: (
    attachment: DraftComposerFileAttachment,
    sourceIdentifier: string,
  ) => void;
};

export function ComposerAttachmentThumbnail(props: ComposerAttachmentThumbnailProps) {
  const upload = useComposerAttachmentUploadState(props.environmentId, props.attachment.id);
  return (
    <View style={{ width: props.size, height: props.size, opacity: props.preparing ? 0.5 : 1 }}>
      <ComposerAttachmentContent {...props} />
      {upload && upload.status !== "ready" ? (
        <Pressable
          accessibilityRole={upload.status === "failed" ? "button" : "text"}
          accessibilityLabel={
            upload.status === "failed"
              ? `Retry uploading ${props.attachment.name}`
              : `Uploading ${props.attachment.name}, ${Math.floor(upload.progress * 100)}%`
          }
          accessibilityHint={upload.status === "failed" ? upload.reason : undefined}
          disabled={upload.status !== "failed"}
          onPress={() =>
            props.environmentId &&
            retryComposerAttachmentUpload(props.environmentId, props.attachment.id)
          }
          className="absolute bottom-0.5 left-0.5 flex-row items-center gap-0.5 rounded-full bg-black/70 px-1 py-0.5"
        >
          <SymbolView
            name={upload.status === "failed" ? "arrow.clockwise" : "arrow.up"}
            size={props.compact ? 8 : 10}
            tintColor="#ffffff"
            type="monochrome"
          />
          {!props.compact ? (
            <Text className="text-2xs text-white">
              {upload.status === "failed" ? "Retry" : `${Math.floor(upload.progress * 100)}%`}
            </Text>
          ) : null}
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Thumbnail URI for a draft image. File-backed previews rebase into the
 * current iOS data container (its UUID changes across installs); the raw
 * persisted URI renders meanwhile, which is correct everywhere but after a
 * container move.
 */
function useComposerImagePreviewUri(attachment: DraftComposerImageAttachment): string {
  const { fileUri, previewUri } = attachment;
  const [rebased, setRebased] = useState<{ fileUri: string; uri: string } | null>(null);
  useEffect(() => {
    if (fileUri === undefined) return;
    let cancelled = false;
    void (async () => {
      const { Paths } = await import("expo-file-system");
      const owned = resolveOwnedComposerAttachmentFileUri(fileUri, Paths.document.uri);
      // Re-render only when the container actually moved.
      if (!cancelled && owned !== null && owned !== previewUri) setRebased({ fileUri, uri: owned });
    })();
    return () => {
      cancelled = true;
    };
  }, [fileUri, previewUri]);
  return fileUri !== undefined && rebased?.fileUri === fileUri ? rebased.uri : previewUri;
}

function ComposerImageAttachment(
  props: ComposerAttachmentThumbnailProps & { readonly attachment: DraftComposerImageAttachment },
) {
  const { attachment } = props;
  const style = { width: props.size, height: props.size, borderRadius: props.borderRadius };
  const previewUri = useComposerImagePreviewUri(attachment);
  const sourceIdentifier = `draft-image:${attachment.id}`;
  return (
    <PresentationSource identifier={sourceIdentifier}>
      <Pressable
        accessibilityRole="imagebutton"
        accessibilityLabel={`Open ${attachment.name}`}
        disabled={props.preparing || (!props.onPressPreview && !props.onPressImage)}
        onPress={() =>
          props.onPressImage
            ? props.onPressImage(previewUri)
            : props.onPressPreview?.(
                // File-backed images open through the retain-lease + container
                // rebase path; legacy drafts still carry their inline bytes.
                isFileBackedComposerAttachment(attachment)
                  ? { kind: "image", attachment, name: attachment.name, sourceIdentifier }
                  : {
                      kind: "image",
                      uri: attachment.dataUrl ?? attachment.previewUri,
                      name: attachment.name,
                      sourceIdentifier,
                    },
              )
        }
      >
        <Image
          source={{ uri: previewUri }}
          style={style}
          className="bg-subtle"
          resizeMode="cover"
        />
      </Pressable>
    </PresentationSource>
  );
}

function ComposerAttachmentContent(props: ComposerAttachmentThumbnailProps) {
  const { attachment } = props;
  const style = { width: props.size, height: props.size, borderRadius: props.borderRadius };
  if (attachment.type === "image") {
    return <ComposerImageAttachment {...props} attachment={attachment} />;
  }
  const onPressVideo = props.onPressVideo;
  if (onPressVideo && videoMimeType(attachment) !== null) {
    return (
      <ComposerVideoAttachment {...props} attachment={attachment} onPressVideo={onPressVideo} />
    );
  }
  const canPreview = isPdfFile(attachment) && props.onPressPreview !== undefined;
  const sourceIdentifier = `draft-file:${attachment.id}`;
  return (
    <PresentationSource identifier={sourceIdentifier}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${attachment.name}`}
        disabled={!canPreview}
        onPress={() =>
          props.onPressPreview?.({
            kind: "pdf",
            name: attachment.name,
            attachment,
            sourceIdentifier,
          })
        }
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
      </Pressable>
    </PresentationSource>
  );
}

function ComposerVideoAttachment(props: {
  readonly attachment: DraftComposerFileAttachment;
  readonly size: number;
  readonly borderRadius: number;
  readonly compact?: boolean;
  readonly preparing?: boolean;
  readonly onPressImage?: (previewUri: string) => void;
  readonly onPressVideo: (
    attachment: DraftComposerFileAttachment,
    sourceIdentifier: string,
  ) => void;
}) {
  const { attachment } = props;
  const sourceIdentifier = `draft:${attachment.id}`;
  const style = { width: props.size, height: props.size, borderRadius: props.borderRadius };
  const actionsSource = useMemo<MediaActionsSource>(
    () => ({
      name: attachment.name,
      mimeType: videoMimeType(attachment) ?? attachment.mimeType,
      sourceIdentifier,
      attachment,
    }),
    [attachment, sourceIdentifier],
  );

  return (
    <VideoAttachmentTile
      name={attachment.name}
      sourceIdentifier={sourceIdentifier}
      thumbnailSource={attachment}
      compact={props.compact}
      onPress={() => props.onPressVideo(attachment, sourceIdentifier)}
      actionsSource={actionsSource}
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
                environmentId={props.environmentId}
                onPressPreview={props.onPressPreview}
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
  readonly backgroundColor?: string;
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
