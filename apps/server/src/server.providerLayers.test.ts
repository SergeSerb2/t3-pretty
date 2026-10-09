import * as NodeFS from "node:fs";
import { describe, expect, it } from "@effect/vitest";

describe("server provider layer composition", () => {
  it("binds the ACP registry catalog through ProviderHost, not the deleted local layer", () => {
    const source = NodeFS.readFileSync(new URL("./server.ts", import.meta.url), "utf8");
    expect(source).not.toContain('from "./provider/AcpRegistryCatalog.ts"');
    expect(source).not.toContain("AcpRegistryCatalogLive");
    expect(source).toContain('from "@t3tools/provider-acp-registry/server/AcpRegistrySupport"');
    expect(source).toContain("AcpRegistrySupport.layerFromHost");
    expect(source).toContain("ProviderHostLive.layer");
    expect(source.match(/layerFromHost/g)?.length).toBe(1);
  });
});
