/**
 * `POST /hooks/automations/:automationId/:token` — the inbound trigger for
 * automations with a webhook trigger. The token in the path is the whole
 * credential (it sits outside environment auth like `/mcp`), so a mismatch
 * and an unknown automation both answer 404. Mounted inside `makeRoutesLayer`
 * so it inherits command readiness and the global body limit.
 */
import {
  AUTOMATION_WEBHOOK_PAYLOAD_MAX_CHARS,
  AutomationId,
  AutomationRunId,
  CommandId,
  DEFAULT_SERVER_SETTINGS,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { timingSafeEqualBase64Url } from "../auth/utils.ts";
import { isOrchestrationCommandRejection } from "../orchestration/Errors.ts";
import * as OrchestrationEngine from "../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";

export const AUTOMATION_WEBHOOK_PATH = "/hooks/automations/:automationId/:token";
export const AUTOMATION_WEBHOOK_MAX_BODY_BYTES = 256 * 1024;
/** One accepted delivery per automation per window; the rest get 429. */
export const AUTOMATION_WEBHOOK_ACCEPT_INTERVAL_MILLIS = 5_000;

const decodeJsonText = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));

const NO_STORE = { "cache-control": "no-store" } as const;
const reply = (status: number, body: Record<string, unknown>) =>
  HttpServerResponse.jsonUnsafe(body, { status, headers: NO_STORE });
const notFound = HttpServerResponse.text("Not Found", { status: 404, headers: NO_STORE });

export const layer = Layer.unwrap(
  Effect.sync(() => {
    // ponytail: per-process limiter map; a multi-process deployment would need
    // the decider's debounce alone, which it already has.
    const lastAcceptedAt = new Map<AutomationId, number>();

    return HttpRouter.add(
      "POST",
      AUTOMATION_WEBHOOK_PATH,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const params = yield* HttpRouter.params;
        const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
        const engine = yield* OrchestrationEngine.OrchestrationEngineService;
        const settingsService = yield* ServerSettingsService;
        const crypto = yield* Crypto.Crypto;

        const automationId = AutomationId.make(params.automationId ?? "");
        const token = params.token ?? "";
        const automation = yield* snapshots.getAutomationShellById(automationId).pipe(
          Effect.map(Option.getOrNull),
          Effect.orElseSucceed(() => null),
        );
        if (
          automation === null ||
          automation.webhookToken === null ||
          token.length === 0 ||
          !automation.triggers.some((trigger) => trigger.type === "webhook") ||
          !timingSafeEqualBase64Url(automation.webhookToken, token)
        ) {
          return notFound;
        }
        if (request.headers["x-github-event"] === "ping") {
          return reply(200, { ok: true });
        }
        const nowMs = (yield* DateTime.now).epochMilliseconds;
        const last = lastAcceptedAt.get(automation.id);
        if (last !== undefined && nowMs - last < AUTOMATION_WEBHOOK_ACCEPT_INTERVAL_MILLIS) {
          return reply(429, { reason: "rate-limited" });
        }
        const settings = yield* settingsService.getSettings.pipe(
          Effect.orElseSucceed(() => DEFAULT_SERVER_SETTINGS),
        );
        if (!automation.enabled || !settings.automations.enabled) {
          return reply(409, { reason: "paused" });
        }

        // The global body limit bounds this read; the webhook's own cap is
        // tighter so a misconfigured sender cannot fill run rows with 100 MB.
        const text = yield* request.text.pipe(Effect.orElseSucceed(() => ""));
        if (Buffer.byteLength(text, "utf8") > AUTOMATION_WEBHOOK_MAX_BODY_BYTES) {
          return reply(413, { reason: "payload-too-large" });
        }
        const trimmed = text.trim();
        if (
          trimmed.length > 0 &&
          Result.isFailure(yield* decodeJsonText(trimmed).pipe(Effect.result))
        ) {
          return reply(400, { reason: "invalid-json" });
        }
        const payload =
          trimmed.length === 0 ? null : trimmed.slice(0, AUTOMATION_WEBHOOK_PAYLOAD_MAX_CHARS);
        const deliveryId = (
          request.headers["x-github-delivery"] ??
          request.headers["x-request-id"] ??
          (yield* crypto.randomUUIDv4.pipe(Effect.orDie))
        )
          .trim()
          .slice(0, 200);
        const runId = AutomationRunId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
        const dispatched = yield* engine
          .dispatch({
            type: "automation.run.request",
            commandId: CommandId.make(`server:automation-webhook:${runId}`),
            automationId: automation.id,
            runId,
            trigger: { type: "webhook", deliveryId: deliveryId || runId, payload },
            requestedAt: DateTime.formatIso(DateTime.makeUnsafe(nowMs)),
          })
          .pipe(Effect.result);
        if (Result.isFailure(dispatched)) {
          const failure = dispatched.failure;
          if (isOrchestrationCommandRejection(failure)) {
            return reply(409, { reason: "detail" in failure ? failure.detail : failure.message });
          }
          yield* Effect.logWarning("automation webhook dispatch failed", {
            automationId: automation.id,
            cause: dispatched.failure,
          });
          return reply(500, { reason: "internal" });
        }
        lastAcceptedAt.set(automation.id, nowMs);
        // Behind an active run the decider coalesces the delivery instead of
        // opening a run, so there is no run id to hand back.
        return reply(202, { runId: automation.activeRun === null ? runId : null });
      }),
    );
  }),
);
