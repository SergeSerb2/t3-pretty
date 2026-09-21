import { cloneElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { ComposerBannerStack, type ComposerBannerStackItem } from "./ComposerBannerStack";

vi.mock("../ui/popover", () => ({
  Popover: "popover",
  PopoverTrigger: ({ render, children }: { render: ReactElement; children: ReactNode }) =>
    cloneElement(render, {}, children),
  PopoverPopup: "popup",
}));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/scroll-area", () => ({ ScrollArea: "div" }));

let renderer: ReactTestRenderer;
afterEach(async () => {
  if (renderer) await act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

const banner = (
  id: string,
  variant: ComposerBannerStackItem["variant"] = "warning",
): ComposerBannerStackItem => ({
  id,
  variant,
  icon: <span aria-hidden="true">!</span>,
  title: `${id} warning`,
});

describe("ComposerBannerStack", () => {
  it("keeps expanded banners in layout flow so surrounding content moves out of their way", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("front"), banner("stacked")]} />,
    );

    const expandedItems = markup.match(
      /<div data-composer-banner-stack-expanded-items="true" class="([^"]+)">/,
    );

    expect(expandedItems?.[1]).toContain("grid-rows-[0fr]");
    expect(expandedItems?.[1]).toContain("group-hover/banner-stack:grid-rows-[1fr]");
    expect(expandedItems?.[1]).toContain("z-20");
    expect(expandedItems?.[1]).not.toContain("absolute");
    expect(markup.indexOf("front warning")).toBeLessThan(markup.indexOf("stacked warning"));
    expect(markup).toContain("invisible pointer-events-none");
    expect(markup).toContain("group-focus-within/banner-stack:visible");
  });

  it("makes the collapsed stack cap a focusable way into the hidden banners", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("front"), banner("stacked")]} />,
    );

    expect(markup).toContain('aria-label="Show 1 more notice"');
    expect(
      renderToStaticMarkup(
        <ComposerBannerStack items={[banner("front"), banner("a"), banner("b")]} />,
      ),
    ).toContain('aria-label="Show 2 more notices"');
  });

  it("colors the collapsed stack cap by the hidden banner's variant, not a fixed warning", () => {
    const neutralBehind = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("front", "default"), banner("stacked", "default")]} />,
    );
    expect(neutralBehind).toContain("chat-composer-banner-stack-cap");
    expect(neutralBehind).toContain("border-[var(--chat-composer-attached-outline)]");
    expect(neutralBehind).not.toContain("border-border");
    expect(neutralBehind).not.toContain("border-warning/24");

    const warningBehind = renderToStaticMarkup(
      <ComposerBannerStack items={[banner("front", "default"), banner("stacked", "warning")]} />,
    );
    expect(warningBehind).toContain("border-warning/24");
  });

  it("does not render an expandable region for a single banner", () => {
    const markup = renderToStaticMarkup(<ComposerBannerStack items={[banner("front")]} />);

    expect(markup).not.toContain("data-composer-banner-stack-expanded-items");
    expect(markup).toContain("chat-composer-drawer-surface");
    expect(markup).toContain("chat-composer-drawer-attached");
    expect(markup).not.toContain("before:mask-none");
    expect(markup).toContain("text-xs");
    expect(markup).toContain('data-composer-banner-drawer="true"');
    expect(markup).toContain('data-variant="warning"');
    expect(markup).toContain("transform:none");
    expect(markup).not.toContain("will-change:transform");
  });

  it("applies item-specific surface and action layout classes", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack
        items={[
          {
            ...banner("branch"),
            className: "branch-surface",
            actionClassName: "branch-actions",
            actions: <button type="button">Repair</button>,
          },
        ]}
      />,
    );

    expect(markup).toContain("branch-surface");
    expect(markup).toContain("branch-actions");
  });

  it("renders a disabled compaction action on the shared accessible banner surface", () => {
    const markup = renderToStaticMarkup(
      <ComposerBannerStack
        items={[
          {
            id: "resume-compaction",
            variant: "info",
            icon: <span aria-hidden="true">!</span>,
            title: "Resume with less context",
            description: "250k tokens from an older session",
            actions: (
              <button type="button" disabled>
                Compact
              </button>
            ),
            dismissLabel: "Keep full history",
            onDismiss: () => {},
          },
        ]}
      />,
    );

    expect(markup).toContain('role="alert"');
    expect(markup).toContain("chat-composer-drawer-attached");
    expect(markup).toContain('disabled=""');
    expect(markup).toContain('aria-label="Keep full history"');
  });
});

it("only offers notice details when the description cannot fit", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let resize = () => {};
  let mutate = () => {};
  vi.stubGlobal(
    "MutationObserver",
    class {
      constructor(callback: () => void) {
        mutate = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  let position = "static";
  vi.stubGlobal("getComputedStyle", () => ({ position }));
  let availableWidth = 200;
  const nested = { clientWidth: 100, scrollWidth: 80 };
  const text = {
    querySelectorAll: () => [nested],
    get clientWidth() {
      return (
        availableWidth -
        (renderer?.root.findAllByProps({ "aria-label": "Show notice details" }).length ? 28 : 0)
      );
    },
    scrollWidth: 80,
  };
  await act(() => {
    renderer = create(
      <ComposerBannerStack
        items={[
          {
            id: "usage",
            variant: "info",
            icon: null,
            title: "Usage limits",
            description: "OpenCode",
          },
        ]}
      />,
      {
        createNodeMock: (element) =>
          element.type === "span" ? text : element.type === "button" ? { offsetWidth: 24 } : null,
      },
    );
  });
  const details = () => renderer.root.findAllByProps({ "aria-label": "Show notice details" });
  expect(details()).toHaveLength(0);
  text.scrollWidth = 300;
  await act(() => resize());
  expect(details()).toHaveLength(1);
  // It fits without the icon: the icon must not keep its own overflow alive.
  availableWidth = 308;
  await act(() => resize());
  expect(details()).toHaveLength(0);
  text.scrollWidth = 80;
  await act(() => resize());
  expect(details()).toHaveLength(0);
  nested.scrollWidth = 500;
  await act(() => mutate());
  expect(details()).toHaveLength(1);
  nested.scrollWidth = 80;
  await act(() => mutate());
  expect(details()).toHaveLength(0);
  position = "absolute";
  await act(() => resize());
  expect(details()).toHaveLength(1);
  position = "static";
  await act(() => resize());
  expect(details()).toHaveLength(0);
});
