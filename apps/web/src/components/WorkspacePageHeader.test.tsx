import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { WorkspacePageHeader } from "./WorkspacePageHeader";

describe("WorkspacePageHeader", () => {
  it("forwards scenery data attributes onto the header element", () => {
    const html = renderToStaticMarkup(
      <WorkspacePageHeader data-pull-requests-header data-chat-header />,
    );

    expect(html.startsWith("<header")).toBe(true);
    expect(html).toContain("data-pull-requests-header");
    expect(html).toContain("data-chat-header");
  });
});
