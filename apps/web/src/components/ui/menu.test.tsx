import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { Menu, MenuCheckboxItem, MenuRadioGroup, MenuRadioItem } from "./menu";
import menuSource from "./menu.tsx?raw";

describe("menu modal default", () => {
  it("does not inert the page while a dropdown is open", () => {
    expect(menuSource).toContain("modal = false");
    expect(menuSource).toContain("modal={modal}");
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
