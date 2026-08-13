import { resolveMarkdownLinkPresentation } from "@t3tools/mobile-markdown-text/links";

export type MarkdownLinkAction = "open" | "copy" | "share";

export interface MarkdownLinkActionItem {
  readonly id: MarkdownLinkAction;
  readonly label: string;
}

export function markdownLinkActionItems(href: string): readonly MarkdownLinkActionItem[] {
  const presentation = resolveMarkdownLinkPresentation(href);
  if (presentation.kind === "file") {
    return [
      { id: "open", label: "Open" },
      { id: "copy", label: "Copy Path" },
    ];
  }

  const items: MarkdownLinkActionItem[] = [
    { id: "open", label: "Open" },
    { id: "copy", label: "Copy Link" },
  ];
  if (presentation.kind === "external") {
    items.push({ id: "share", label: "Share" });
  }
  return items;
}

export function markdownLinkActionTitle(href: string): string | null {
  const presentation = resolveMarkdownLinkPresentation(href);
  if (presentation.kind === "external") {
    return presentation.host;
  }
  if (presentation.kind === "file") {
    return presentation.label;
  }
  return null;
}

export function markdownLinkCopyValue(href: string): string {
  const presentation = resolveMarkdownLinkPresentation(href);
  if (presentation.kind === "file") {
    return presentation.path;
  }
  return presentation.href ?? href;
}
