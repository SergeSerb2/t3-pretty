import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ADVERTISED_ENDPOINT_URL_MAX_LENGTH } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as DesktopConfig from "./DesktopConfig.ts";

const readConfig = (env: Readonly<Record<string, string | undefined>>) =>
  DesktopConfig.DesktopConfig.pipe(
    Effect.provide(Layer.mergeAll(NodeServices.layer, DesktopConfig.layerTest(env))),
  );

describe("DesktopConfig", () => {
  it.effect("bounds configured HTTPS endpoint fanout", () =>
    Effect.gen(function* () {
      const configured = Array.from(
        { length: DesktopConfig.DESKTOP_HTTPS_ENDPOINTS_MAX_ITEMS + 2 },
        (_, index) => `https://endpoint-${index}.example.test`,
      );
      const config = yield* readConfig({
        T3CODE_DESKTOP_HTTPS_ENDPOINTS: configured.join(","),
      });

      assert.equal(
        config.desktopHttpsEndpointUrls.length,
        DesktopConfig.DESKTOP_HTTPS_ENDPOINTS_MAX_ITEMS,
      );
      assert.deepEqual(
        config.desktopHttpsEndpointUrls,
        configured.slice(0, DesktopConfig.DESKTOP_HTTPS_ENDPOINTS_MAX_ITEMS),
      );
    }),
  );

  it.effect("drops oversized endpoint entries without truncating them into different URLs", () =>
    Effect.gen(function* () {
      const oversized = `https://oversized.example.test/${"x".repeat(
        ADVERTISED_ENDPOINT_URL_MAX_LENGTH,
      )}`;
      const config = yield* readConfig({
        T3CODE_DESKTOP_HTTPS_ENDPOINTS: `${oversized},https://kept.example.test`,
      });

      assert.deepEqual(config.desktopHttpsEndpointUrls, ["https://kept.example.test"]);
    }),
  );
});
