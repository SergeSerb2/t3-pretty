import { describe, expect, it } from "vite-plus/test";
import { ENTITY_ID_MAX_LENGTH } from "@t3tools/contracts";

import { resolveActiveThreadPathname } from "./useActiveThreadKey";

describe("resolveActiveThreadPathname", () => {
  it("decodes canonical server and legacy draft routes", () => {
    expect(resolveActiveThreadPathname("/env%201/thread%2F2")).toEqual({
      kind: "server",
      threadRef: { environmentId: "env 1", threadId: "thread/2" },
    });
    expect(resolveActiveThreadPathname("/draft/env%3Athread")).toEqual({
      kind: "draft",
      draftId: "env:thread",
    });
  });

  it("returns null for malformed and reserved paths", () => {
    expect(resolveActiveThreadPathname("/env/%")).toBeNull();
    expect(resolveActiveThreadPathname("/draft/%E0%A4%A")).toBeNull();
    expect(resolveActiveThreadPathname("/%64raft/thread")).toBeNull();
    expect(resolveActiveThreadPathname("/settings/general")).toBeNull();
  });

  it("rejects oversized encoded route identifiers before decoding", () => {
    expect(resolveActiveThreadPathname(`/env/${"t".repeat(ENTITY_ID_MAX_LENGTH + 1)}`)).toBeNull();
    expect(
      resolveActiveThreadPathname(`/draft/${"d".repeat(ENTITY_ID_MAX_LENGTH * 2 + 2)}`),
    ).toBeNull();
  });
});
