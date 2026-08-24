/**
 * Provider-neutral labeling for browser-automation (preview_*) tool calls.
 *
 * Every provider drives the same t3-code MCP browser tools, but each reports
 * the call differently: Claude as `toolName: "mcp__t3-code__preview_click"`
 * with normalized `arguments`, Codex as `item.tool: "preview_click"` with
 * `item.arguments`, and ACP providers (Cursor, Grok, Kimi) as a free-text
 * title. This module recognizes all three and produces one human sentence,
 * so chat timelines render "Clicked “Send”" instead of raw JSON.
 */

export type PreviewAutomationCallOperation =
  | "status"
  | "open"
  | "navigate"
  | "resize"
  | "set_appearance"
  | "snapshot"
  | "click"
  | "type"
  | "press"
  | "scroll"
  | "evaluate"
  | "wait_for"
  | "recording_start"
  | "recording_stop";

export interface PreviewAutomationCallSummary {
  readonly operation: PreviewAutomationCallOperation;
  readonly label: string;
}

// `\b` fails on the Claude form mcp__t3-code__preview_click (underscore is a
// word character), so allow any non-alphanumeric — or start — before "preview_".
const PREVIEW_TOOL_NAME_PATTERN =
  /(?:^|[^a-zA-Z0-9])preview_(status|open|navigate|resize|set_appearance|snapshot|click|type|press|scroll|evaluate|wait_for|recording_start|recording_stop)(?![a-zA-Z0-9_])/;

const LABEL_CLIP_CHARS = 40;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function clip(value: string, maxChars = LABEL_CLIP_CHARS): string {
  const trimmed = value.trim();
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 1)}…` : trimmed;
}

/**
 * Turns a Playwright locator or CSS selector into the shortest phrase a
 * human would use for the same target: the accessible name when present,
 * the text for text locators, otherwise the raw selector clipped.
 */
export function humanizePreviewTarget(target: string): string {
  const nameMatch = target.match(/\[name=(?:'([^']*)'|"([^"]*)")\]/);
  const name = nameMatch?.[1] ?? nameMatch?.[2];
  if (name) return clip(name);
  const textMatch = target.match(/^text=(.+)$/);
  if (textMatch?.[1]) return clip(textMatch[1]);
  return clip(target);
}

function shortUrl(url: string): string {
  return clip(url.replace(/^https?:\/\//, "").replace(/\/$/, ""), 48);
}

function targetPhrase(args: Record<string, unknown>): string | null {
  const locator = asString(args.locator) ?? asString(args.selector);
  return locator ? `“${humanizePreviewTarget(locator)}”` : null;
}

const MODIFIER_LABELS: Record<string, string> = {
  Alt: "Alt",
  Control: "Ctrl",
  Meta: "Cmd",
  Shift: "Shift",
};

function labelForCall(
  operation: PreviewAutomationCallOperation,
  args: Record<string, unknown>,
): string {
  switch (operation) {
    case "click": {
      const target = targetPhrase(args);
      if (target) return `Clicked ${target}`;
      if (typeof args.x === "number" && typeof args.y === "number") {
        return `Clicked at (${Math.round(args.x)}, ${Math.round(args.y)})`;
      }
      return "Clicked in the browser";
    }
    case "type": {
      const text = typeof args.text === "string" ? args.text : null;
      if (text !== null && text.length === 0 && args.clear === true) {
        return "Cleared a text field";
      }
      if (text) return `Typed “${clip(text)}”`;
      return "Typed in the browser";
    }
    case "press": {
      const key = asString(args.key);
      if (!key) return "Pressed a key";
      const modifiers = Array.isArray(args.modifiers)
        ? args.modifiers.flatMap((entry) =>
            typeof entry === "string" ? [MODIFIER_LABELS[entry] ?? entry] : [],
          )
        : [];
      return `Pressed ${[...modifiers, key].join("+")}`;
    }
    case "scroll": {
      const deltaX = typeof args.deltaX === "number" ? args.deltaX : 0;
      const deltaY = typeof args.deltaY === "number" ? args.deltaY : 0;
      if (Math.abs(deltaY) >= Math.abs(deltaX) && deltaY !== 0) {
        return deltaY > 0 ? "Scrolled down" : "Scrolled up";
      }
      if (deltaX !== 0) return deltaX > 0 ? "Scrolled right" : "Scrolled left";
      return "Scrolled";
    }
    case "navigate": {
      const url = asString(args.url);
      if (url) return `Opened ${shortUrl(url)}`;
      const target = asRecord(args.target);
      if (target && typeof target.port === "number") {
        const path = asString(target.path) ?? "";
        return `Opened localhost:${target.port}${path}`;
      }
      return "Opened a page";
    }
    case "open": {
      const url = asString(args.url);
      return url ? `Opened the browser at ${shortUrl(url)}` : "Opened the browser";
    }
    case "status":
      return "Checked the browser";
    case "snapshot":
      return "Looked at the page";
    case "resize": {
      const preset = asString(args.preset);
      if (preset) return `Resized to ${preset}`;
      if (typeof args.width === "number" && typeof args.height === "number") {
        return `Resized to ${args.width}×${args.height}`;
      }
      return "Reset the viewport";
    }
    case "set_appearance": {
      const scheme = asString(args.colorScheme);
      if (scheme === "light" || scheme === "dark") {
        return `Switched the page to ${scheme} mode`;
      }
      return "Matched the system appearance";
    }
    case "evaluate":
      return "Ran a page script";
    case "wait_for": {
      const text = asString(args.text);
      if (text) return `Waited for “${clip(text)}”`;
      const target = targetPhrase(args);
      if (target) return `Waited for ${target}`;
      const urlIncludes = asString(args.urlIncludes);
      if (urlIncludes) return `Waited for URL “${clip(urlIncludes)}”`;
      return "Waited for the page";
    }
    case "recording_start":
      return "Started recording";
    case "recording_stop":
      return "Stopped recording";
  }
}

/**
 * Recognizes a browser-automation tool call from an activity payload's
 * `data` (any provider shape) or a display title, or returns null when the
 * call is not a preview_* tool.
 */
export function summarizePreviewAutomationCall(input: {
  readonly data?: unknown;
  readonly title?: string | null;
}): PreviewAutomationCallSummary | null {
  const data = asRecord(input.data);
  const item = asRecord(data?.item);
  const toolName = asString(item?.tool) ?? asString(data?.toolName) ?? asString(input.title) ?? "";
  const match = PREVIEW_TOOL_NAME_PATTERN.exec(toolName);
  if (!match) return null;
  const operation = match[1] as PreviewAutomationCallOperation;
  const args = asRecord(item?.arguments) ?? asRecord(data?.arguments) ?? {};
  return { operation, label: labelForCall(operation, args) };
}
