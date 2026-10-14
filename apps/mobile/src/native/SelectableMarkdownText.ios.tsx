import { useCallback } from "react";
import type { ScrollViewProps } from "react-native";
import {
  SelectableMarkdownText as T3SelectableMarkdownText,
  MarkdownScrollViewRendererContext,
  type SelectableMarkdownTextProps,
} from "@t3tools/mobile-markdown-text/renderer";

import { highlightCodeSnippet } from "../features/review/shikiReviewHighlighter";
import { ThreadLeaveGestureScrollView } from "../features/threads/ThreadLeaveGesture";
import { showMarkdownLinkActionSheet } from "../lib/showMarkdownLinkActions";

type MobileSelectableMarkdownTextProps = Omit<SelectableMarkdownTextProps, "highlightCode">;

function renderHorizontalScrollView(props: ScrollViewProps) {
  return <ThreadLeaveGestureScrollView {...props} />;
}

export type {
  MarkdownFileContextMenu,
  MarkdownFileContextMenuAction,
  MarkdownImageRenderer,
  MarkdownImageRequest,
  MarkdownImageSourceResolver,
  MarkdownLinkCustomization,
  NativeMarkdownTextStyle,
  SelectableMarkdownSkill,
} from "@t3tools/mobile-markdown-text/types";

export function hasNativeSelectableMarkdownText(): boolean {
  return true;
}

export function SelectableMarkdownText({
  onLinkPress,
  onLinkLongPress,
  ...props
}: MobileSelectableMarkdownTextProps) {
  const defaultLinkLongPress = useCallback(
    (href: string) => {
      if (!onLinkPress) {
        return;
      }
      showMarkdownLinkActionSheet({ href, onOpen: onLinkPress });
    },
    [onLinkPress],
  );

  return (
    <MarkdownScrollViewRendererContext value={renderHorizontalScrollView}>
      <T3SelectableMarkdownText
        {...props}
        highlightCode={highlightCodeSnippet}
        onLinkPress={onLinkPress}
        onLinkLongPress={onLinkLongPress ?? (onLinkPress ? defaultLinkLongPress : undefined)}
      />
    </MarkdownScrollViewRendererContext>
  );
}
