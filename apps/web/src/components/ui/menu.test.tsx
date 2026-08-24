import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import * as NodeFS from "node:fs";

import { Menu, MenuCheckboxItem, MenuRadioGroup, MenuRadioItem } from "./menu";
import menuSource from "./menu.tsx?raw";

// ?raw on a .css module yields "" under the test pipeline (the CSS transform
// wins), so the stylesheet is read straight from disk.
const indexCss = NodeFS.readFileSync(new URL("../../index.css", import.meta.url), "utf8");

describe("menu modal default", () => {
  it("does not inert the page while a dropdown is open", () => {
    expect(menuSource).toContain("modal = false");
    expect(menuSource).toContain("modal={modal}");
  });
});

describe("menu flyout pointer events", () => {
  // Base UI's hover traversal writes inline pointer-events: none on the parent
  // popup while a flyout is open; without this override the whole menu goes
  // dead and reads as stuck. The rule must stay scoped to [data-open] so
  // closing popups keep their exit transition inert.
  it("keeps the parent menu interactive while a flyout is open", () => {
    expect(indexCss).toMatch(
      /\[data-slot="menu-popup"\]\[data-open\]\s*,\s*\[data-slot="menu-sub-content"\]\[data-open\]\s*\{\s*pointer-events:\s*auto\s*!important/,
    );
  });
});

describe("menu radio item geometry", () => {
  it("keeps radio-item icons on the same text grid as menu items", () => {
    const html = renderToStaticMarkup(
      <Menu>
        <MenuRadioGroup value="merge">
          <MenuRadioItem value="merge">
            <span className="flex items-center gap-2">
              <svg aria-hidden className="size-3.5" />
              <span>Merge</span>
            </span>
          </MenuRadioItem>
        </MenuRadioGroup>
      </Menu>,
    );

    expect(html).toContain("-mx-0.5");
  });
});

describe("menu overflow", () => {
  it("lets switch labels shrink instead of stretching the row", () => {
    const html = renderToStaticMarkup(
      <Menu>
        <MenuCheckboxItem checked={false} variant="switch">
          computer-workflow-organization-and-performance
        </MenuCheckboxItem>
      </Menu>,
    );

    expect(html).toContain("min-w-0");
    expect(html).toContain("overflow-hidden");
  });
});
