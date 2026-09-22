import { ApprovalRequestId } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ComposerPendingSecretPanel } from "./ComposerPendingSecretPanel";

const request = {
  requestId: ApprovalRequestId.make("secret-1"),
  createdAt: "2026-09-22T00:00:00.000Z",
  name: "OPENAI_API_KEY",
  header: "OpenAI API key",
  purpose: "Needed to call the API.",
};

describe("ComposerPendingSecretPanel", () => {
  it("stays out of the composer form so Enter can save the key", () => {
    const markup = renderToStaticMarkup(
      <ComposerPendingSecretPanel
        request={request}
        isResponding={false}
        onProvide={() => undefined}
        onDecline={() => undefined}
      />,
    );

    // A nested <form> submits on Enter without React ever seeing the event,
    // which reloads the desktop window. The key field handles Enter itself.
    expect(markup).not.toContain("<form");
    expect(markup).toContain('type="password"');
    expect(markup).toContain('type="button"');
    expect(markup).not.toContain('type="submit"');
    expect(markup).toContain("data-pending-secret-input");
    expect(markup).toContain("data-pending-secret-submit");
  });
});
