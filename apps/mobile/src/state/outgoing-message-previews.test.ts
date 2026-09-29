import { describe, expect, it } from "vite-plus/test";
import { MessageId } from "@t3tools/contracts";

import {
  boundOutgoingMessagePreviewUris,
  getOutgoingMessagePreviewUris,
  previewUrisFromDraftAttachments,
  rememberOutgoingMessageDraftAttachments,
  rememberOutgoingMessagePreviewUris,
} from "./outgoing-message-previews";

describe("outgoing message previews", () => {
  it("extracts composer thumbnail URIs in send order", () => {
    expect(
      previewUrisFromDraftAttachments([
        {
          id: "a",
          type: "image",
          name: "one.png",
          mimeType: "image/png",
          sizeBytes: 4,
          dataUrl: "data:image/png;base64,AA==",
          previewUri: "file:///tmp/one.png",
        },
        {
          id: "b",
          type: "image",
          name: "two.png",
          mimeType: "image/png",
          sizeBytes: 4,
          dataUrl: "data:image/png;base64,BB==",
          previewUri: "data:image/png;base64,BB==",
        },
      ]),
    ).toEqual(["file:///tmp/one.png", "data:image/png;base64,BB=="]);
  });

  it("remembers preview URIs by the sent message id and ignores empty updates", () => {
    const messageId = MessageId.make("11111111-1111-4111-8111-111111111111");
    rememberOutgoingMessageDraftAttachments(messageId, [
      {
        id: "a",
        type: "image",
        name: "one.png",
        mimeType: "image/png",
        sizeBytes: 4,
        dataUrl: "data:image/png;base64,AA==",
        previewUri: "file:///tmp/one.png",
      },
    ]);
    rememberOutgoingMessagePreviewUris(messageId, []);

    expect(getOutgoingMessagePreviewUris()[messageId]).toEqual(["file:///tmp/one.png"]);
  });

  it("evicts the oldest entries once the record grows past the cap", () => {
    for (let index = 0; index < 40; index += 1) {
      rememberOutgoingMessagePreviewUris(`cap-test-${index}`, [`file:///tmp/cap-${index}.png`]);
    }

    const previews = getOutgoingMessagePreviewUris();
    const capTestKeys = Object.keys(previews).filter((key) => key.startsWith("cap-test-"));
    expect(capTestKeys).toHaveLength(32);
    expect(capTestKeys[0]).toBe("cap-test-8");
    expect(previews["cap-test-39"]).toEqual(["file:///tmp/cap-39.png"]);
  });

  it("bounds aggregate preview URI characters while preserving the newest entry", () => {
    expect(
      boundOutgoingMessagePreviewUris(
        {
          old: ["12345"],
          newest: ["abcdef", "ghij"],
        },
        { maxEntries: 10, maxUriCharacters: 7 },
      ),
    ).toEqual({ newest: ["abcdef"] });
  });
});
