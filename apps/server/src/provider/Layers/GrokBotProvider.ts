import { GROK_BOT_MODEL, type GrokBotSettings, type ServerProviderModel } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { type GrokBotClient, GrokBotGatewayError } from "../grokBot/GrokBotGateway.ts";

const isGatewayError = Schema.is(GrokBotGatewayError);
import { buildServerProvider, type ServerProviderDraft } from "../providerSnapshot.ts";

const GROK_BOT_PRESENTATION = {
  displayName: "Grok Bot",
  badgeLabel: "Experimental",
  showInteractionModeToggle: false,
  supportsNativeResume: false,
} as const;

const PROBE_TIMEOUT_MS = 15_000;

/** Grok Bot has no model picker; the single entry keeps the UI's model plumbing happy. */
const GROK_BOT_MODELS: ReadonlyArray<ServerProviderModel> = [
  {
    slug: GROK_BOT_MODEL,
    name: "Grok Bot",
    isCustom: false,
    isDefault: true,
    capabilities: createModelCapabilities({ optionDescriptors: [] }),
  },
];

export function buildInitialGrokBotProviderSnapshot(
  settings: GrokBotSettings,
): Effect.Effect<ServerProviderDraft> {
  return Effect.map(DateTime.now, (now) =>
    buildServerProvider({
      presentation: GROK_BOT_PRESENTATION,
      enabled: settings.enabled,
      checkedAt: DateTime.formatIso(now),
      models: GROK_BOT_MODELS,
      probe: settings.enabled
        ? {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Checking Grok Bot access...",
          }
        : {
            installed: true,
            version: null,
            status: "warning",
            auth: { status: "unknown" },
            message: "Grok Bot is disabled in T3 Code settings.",
          },
    }),
  );
}

/**
 * Auth probe: the Cursor token must be accepted by `GrokBotService`, and the
 * account must own a box we can reach. Nothing is installed locally, so
 * `installed` is always true.
 */
export const checkGrokBotProviderStatus = Effect.fn("checkGrokBotProviderStatus")(function* (
  settings: GrokBotSettings,
  client: GrokBotClient,
) {
  if (!settings.enabled) return yield* buildInitialGrokBotProviderSnapshot(settings);
  const checkedAt = DateTime.formatIso(yield* DateTime.now);
  // The capabilities call is uncached, so an expired token surfaces here even
  // when the box location is still cached.
  const probe = yield* client
    .api("GetGrokBotRuntimeCapabilities", {})
    .pipe(Effect.andThen(client.ensureBox), Effect.timeoutOption(PROBE_TIMEOUT_MS), Effect.result);
  if (Result.isFailure(probe)) {
    const error = probe.failure;
    const unauthenticated = isGatewayError(error) && error.unauthenticated;
    return buildServerProvider({
      presentation: GROK_BOT_PRESENTATION,
      enabled: true,
      checkedAt,
      models: GROK_BOT_MODELS,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: unauthenticated ? "unauthenticated" : "unknown" },
        message: unauthenticated
          ? "Grok Bot needs a Cursor sign-in. Run `cursor-agent login` on this machine, then refresh provider status."
          : `Grok Bot is unreachable: ${error.message}`,
      },
    });
  }
  if (probe.success._tag === "None") {
    return buildServerProvider({
      presentation: GROK_BOT_PRESENTATION,
      enabled: true,
      checkedAt,
      models: GROK_BOT_MODELS,
      probe: {
        installed: true,
        version: null,
        status: "error",
        auth: { status: "unknown" },
        message: `Grok Bot did not answer within ${PROBE_TIMEOUT_MS}ms.`,
      },
    });
  }
  return buildServerProvider({
    presentation: GROK_BOT_PRESENTATION,
    enabled: true,
    checkedAt,
    models: GROK_BOT_MODELS,
    probe: {
      installed: true,
      version: null,
      status: "ready",
      auth: { status: "authenticated", type: "cursor" },
    },
  });
});
