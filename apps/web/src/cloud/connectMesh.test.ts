import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import * as Option from "effect/Option";

import { buildRelayMeshRegistrations } from "./connectMesh";

describe("buildRelayMeshRegistrations", () => {
  it("builds a deterministic catalog without the local environment", () => {
    const primaryEnvironmentId = EnvironmentId.make("environment-primary");
    const registrations = buildRelayMeshRegistrations(
      [
        { environmentId: EnvironmentId.make("environment-z"), label: "Z machine" },
        { environmentId: primaryEnvironmentId, label: "This machine" },
        { environmentId: EnvironmentId.make("environment-a"), label: "A machine" },
      ].map((environment) => ({
        environment: {
          ...environment,
          endpoint: {
            httpBaseUrl: `https://${environment.environmentId}.example.test`,
            wsBaseUrl: `wss://${environment.environmentId}.example.test`,
            providerKind: "cloudflare_tunnel" as const,
          },
          linkedAt: "2026-08-11T00:00:00.000Z",
        },
        availability: "online" as const,
        status: Option.none(),
        error: Option.none(),
      })),
      primaryEnvironmentId,
    );

    expect(registrations.map(({ target }) => [target.environmentId, target.label])).toEqual([
      ["environment-a", "A machine"],
      ["environment-z", "Z machine"],
    ]);
  });
});
