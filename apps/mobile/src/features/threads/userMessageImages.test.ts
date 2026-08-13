import { describe, expect, it } from "vite-plus/test";

import { resolveUserMessageImageSources } from "./userMessageImages";

describe("resolveUserMessageImageSources", () => {
  it("uses local composer previews when the server message has no attachments yet", () => {
    expect(
      resolveUserMessageImageSources({
        attachments: [],
        localPreviewUris: ["file:///tmp/one.png", "data:image/png;base64,AA=="],
      }),
    ).toEqual([
      {
        key: "local:0",
        attachmentId: null,
        localPreviewUri: "file:///tmp/one.png",
      },
      {
        key: "local:1",
        attachmentId: null,
        localPreviewUri: "data:image/png;base64,AA==",
      },
    ]);
  });

  it("keeps server attachment ids and overlays local previews by index", () => {
    expect(
      resolveUserMessageImageSources({
        attachments: [{ id: "server-a" }, { id: "server-b" }],
        localPreviewUris: ["file:///tmp/one.png"],
      }),
    ).toEqual([
      {
        key: "server-a",
        attachmentId: "server-a",
        localPreviewUri: "file:///tmp/one.png",
      },
      {
        key: "server-b",
        attachmentId: "server-b",
        localPreviewUri: null,
      },
    ]);
  });

  it("renders nothing when neither server attachments nor local previews exist", () => {
    expect(resolveUserMessageImageSources({ attachments: [] })).toEqual([]);
  });
});
