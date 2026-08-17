import { useCallback, useMemo } from "react";
import {
  Markdown,
  type CustomRenderers,
  type NodeStyleOverrides,
  type PartialMarkdownTheme,
} from "react-native-nitro-markdown";
import { Pressable, Text as NativeText, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { tryOpenExternalUrl } from "../../lib/openExternalUrl";
import { showMarkdownLinkActionSheet } from "../../lib/showMarkdownLinkActions";
import { useFontFamily } from "../../lib/useFontFamily";
import {
  resolveMarkdownFontSizes,
  resolveNativeMarkdownTypography,
} from "../../lib/appearancePreferences";
import { useThemeColor } from "../../lib/useThemeColor";
import { useAppearancePreferences } from "../settings/appearance/AppearancePreferencesProvider";
import {
  hasNativeSelectableMarkdownText,
  SelectableMarkdownText,
} from "../../native/SelectableMarkdownText";
import { pullRequestBodySegments } from "./pullRequestMarkdown.logic";

export function PullRequestMarkdown(props: {
  readonly markdown: string;
  readonly density?: "body" | "comment";
}) {
  const segments = useMemo(() => pullRequestBodySegments(props.markdown), [props.markdown]);
  const muted = String(useThemeColor("--color-icon-subtle"));

  if (segments.length === 0) {
    return null;
  }

  return (
    <View className="min-w-0 gap-2.5 overflow-hidden">
      {segments.map((segment) => {
        if (segment.kind === "markdown") {
          return (
            <MarkdownRun
              key={segment.id}
              density={props.density ?? "body"}
              markdown={segment.text}
            />
          );
        }
        return (
          <Pressable
            key={segment.id}
            accessibilityRole="link"
            onPress={() => void tryOpenExternalUrl(segment.url, "markdown-link")}
            style={({ pressed }) => ({ opacity: pressed ? 0.72 : 1 })}
            className="flex-row items-center gap-2 rounded-xl bg-subtle px-3 py-2.5"
          >
            <SymbolView
              name={segment.media === "video" ? "play" : "arrow.up.right"}
              size={14}
              tintColor={muted}
              type="monochrome"
            />
            <Text
              className="min-w-0 flex-1 text-sm font-t3-medium text-foreground"
              numberOfLines={1}
            >
              {segment.media === "video" ? "Play video on the host" : "Open attachment on the host"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function MarkdownRun(props: { readonly markdown: string; readonly density: "body" | "comment" }) {
  const { appearance } = useAppearancePreferences();
  const commentBase = Math.max(13, Math.round(appearance.baseFontSize * 0.875));
  const baseFontSize = props.density === "comment" ? commentBase : appearance.baseFontSize;
  const markdownFontSizes = useMemo(() => resolveMarkdownFontSizes(baseFontSize), [baseFontSize]);
  const nativeMarkdownTypography = useMemo(() => {
    const typography = resolveNativeMarkdownTypography(baseFontSize);
    if (props.density !== "comment") return typography;
    // Comment cards cannot carry document-sized headings. Keep them just above body size.
    return {
      ...typography,
      headingFontSizes: [
        typography.fontSize + 3,
        typography.fontSize + 2,
        typography.fontSize + 1,
        typography.fontSize,
        typography.fontSize,
        typography.fontSize,
      ] as const,
    };
  }, [baseFontSize, props.density]);
  const body = String(useThemeColor("--color-md-body"));
  const strong = String(useThemeColor("--color-md-strong"));
  const link = String(useThemeColor("--color-md-link"));
  const blockquoteBorder = String(useThemeColor("--color-md-blockquote-border"));
  const blockquoteBackground = String(useThemeColor("--color-md-blockquote-bg"));
  const codeBackground = String(useThemeColor("--color-md-code-bg"));
  const codeText = String(useThemeColor("--color-md-code-text"));
  const horizontalRule = String(useThemeColor("--color-md-hr"));
  const regularFontFamily = useFontFamily("regular");
  const mediumFontFamily = useFontFamily("medium");
  const boldFontFamily = useFontFamily("bold");
  const onLinkPress = useCallback((href: string) => {
    void tryOpenExternalUrl(href, "markdown-link");
  }, []);
  const onLinkLongPress = useCallback(
    (href: string) => {
      showMarkdownLinkActionSheet({ href, onOpen: onLinkPress });
    },
    [onLinkPress],
  );

  const renderers: CustomRenderers = useMemo(
    () => ({
      link: ({ href, children }) => (
        <NativeText
          className="font-t3-medium"
          onPress={() => {
            if (href) onLinkPress(href);
          }}
          onLongPress={() => {
            if (href) onLinkLongPress(href);
          }}
          style={{ color: link, textDecorationLine: "none" }}
        >
          {children}
        </NativeText>
      ),
    }),
    [link, onLinkLongPress, onLinkPress],
  );
  const theme: PartialMarkdownTheme = useMemo(
    () => ({
      colors: {
        text: body,
        heading: strong,
        link,
        blockquote: blockquoteBorder,
        border: horizontalRule,
        surface: "transparent",
        surfaceLight: blockquoteBackground,
        accent: link,
        tableBorder: horizontalRule,
        tableHeader: blockquoteBackground,
        tableHeaderText: strong,
        tableRowOdd: blockquoteBackground,
        tableRowEven: "transparent",
        code: codeText,
        codeBackground,
      },
    }),
    [
      blockquoteBackground,
      blockquoteBorder,
      body,
      codeBackground,
      codeText,
      horizontalRule,
      link,
      strong,
    ],
  );
  const headingSize = props.density === "comment" ? markdownFontSizes.m + 1 : markdownFontSizes.h3;
  const styles: NodeStyleOverrides = useMemo(
    () => ({
      text: {
        color: body,
        fontFamily: regularFontFamily,
        fontSize: markdownFontSizes.m,
        lineHeight: markdownFontSizes.bodyLineHeight,
      },
      heading: {
        color: strong,
        fontFamily: boldFontFamily,
        fontSize: headingSize,
        lineHeight: headingSize + 6,
      },
      strong: { color: strong, fontFamily: boldFontFamily },
      link: { color: link, fontFamily: mediumFontFamily },
      blockquote: {
        backgroundColor: blockquoteBackground,
        borderLeftColor: blockquoteBorder,
        borderLeftWidth: 3,
        paddingLeft: 12,
      },
      code: { backgroundColor: codeBackground, color: codeText, fontFamily: regularFontFamily },
    }),
    [
      blockquoteBackground,
      blockquoteBorder,
      body,
      boldFontFamily,
      codeBackground,
      codeText,
      headingSize,
      link,
      markdownFontSizes.bodyLineHeight,
      markdownFontSizes.m,
      mediumFontFamily,
      regularFontFamily,
      strong,
    ],
  );

  if (props.markdown.trim().length === 0) {
    return null;
  }

  return (
    <View className="min-w-0 overflow-hidden">
      {hasNativeSelectableMarkdownText() ? (
        <SelectableMarkdownText
          markdown={props.markdown}
          onLinkPress={onLinkPress}
          textStyle={{
            color: body,
            strongColor: strong,
            mutedColor: body,
            linkColor: link,
            inlineCodeColor: codeText,
            codeColor: codeText,
            codeBackgroundColor: codeBackground,
            codeBlockBackgroundColor: codeBackground,
            fileTextColor: codeText,
            skillTextColor: codeText,
            quoteMarkerColor: blockquoteBorder,
            dividerColor: horizontalRule,
            fontSize: nativeMarkdownTypography.fontSize,
            lineHeight: nativeMarkdownTypography.lineHeight,
            headingFontSizes: nativeMarkdownTypography.headingFontSizes,
            fontFamily: regularFontFamily,
            headingFontFamily: boldFontFamily,
            boldFontFamily,
          }}
        />
      ) : (
        <Markdown options={{ gfm: true }} renderers={renderers} styles={styles} theme={theme}>
          {props.markdown}
        </Markdown>
      )}
    </View>
  );
}
