import { useCallback } from "react";
import {
  SelectableMarkdownText as T3SelectableMarkdownText,
  type SelectableMarkdownTextProps,
} from "@t3tools/mobile-markdown-text/renderer";

import { highlightCodeSnippet } from "../features/review/shikiReviewHighlighter";
import { showMarkdownLinkActionSheet } from "../lib/showMarkdownLinkActions";

type MobileSelectableMarkdownTextProps = Omit<SelectableMarkdownTextProps, "highlightCode">;

export type {
  MarkdownImageRenderer,
  MarkdownImageRequest,
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
    <T3SelectableMarkdownText
      {...props}
      highlightCode={highlightCodeSnippet}
      onLinkPress={onLinkPress}
      onLinkLongPress={onLinkLongPress ?? (onLinkPress ? defaultLinkLongPress : undefined)}
    />
  );
}
