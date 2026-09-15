import * as NodeCryptoLayer from "@effect/platform-node/NodeCrypto";
import { describe, expect, it } from "@effect/vitest";
import { AUTH_CREDENTIAL_MAX_LENGTH, EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import * as RelayConfiguration from "../Config.ts";
import * as ApnsDeliveryQueue from "./ApnsDeliveryQueue.ts";
import type { SignedApnsDeliveryJob } from "./apnsDeliveryJobs.ts";

const config: RelayConfiguration.RelayConfiguration["Service"] = {
  relayIssuer: "https://relay.example.com",
  apns: {
    teamId: "team-1",
    keyId: "key-1",
    privateKey: Redacted.make("apns-private-key"),
    bundleId: "com.t3tools.test",
    environment: "sandbox",
  },
  clerkSecretKey: Redacted.make("clerk-secret"),
  clerkPublishableKey: "pk_test_test",
  clerkJwtAudience: "t3-code-relay",
  apnsDeliveryJobSigningSecret: Redacted.make("apns-job-secret"),
  cloudMintPrivateKey: Redacted.make("cloud-private-key"),
  cloudMintPublicKey: "cloud-public-key",
  managedEndpointBaseDomain: undefined,
  managedEndpointNamespace: undefined,
};

describe("ApnsDeliveryQueue", () => {
  it.effect("does not require the deployment RuntimeContext when building the Worker layer", () => {
    const sent: unknown[] = [];
    const sender: Cloudflare.Queues.WriteQueueClient = {
      raw: Effect.die("raw queue binding is not used"),
      send: (body) =>
        Effect.sync(() => {
          sent.push(body);
        }),
      sendBatch: () => Effect.die("batch queue binding is not used"),
    };
    const runtimeContext = {} as Alchemy.BaseRuntimeContext;
    const layer = ApnsDeliveryQueue.layerCloudflareQueues(sender, runtimeContext).pipe(
      Layer.provide(NodeCryptoLayer.layer),
      Layer.provide(RelayConfiguration.layer(config)),
    );

    return Effect.gen(function* () {
      const queue = yield* ApnsDeliveryQueue.ApnsDeliveryQueue;
      yield* queue.enqueuePushNotification({
        userId: "user-1",
        deviceId: "device-1",
        token: "push-token",
        notification: {
          title: "Thread",
          body: "Input: Project",
          environmentId: "env-1",
          threadId: "thread-1",
          deepLink: "/threads/env-1/thread-1",
        },
      });

      expect(sent).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("preserves job identity and the queue sender cause", () => {
    const cause = new Error("queue unavailable");
    const senderCause = new Cloudflare.Queues.SendError({
      message: cause.message,
      cause,
    });
    const layer = ApnsDeliveryQueue.layer.pipe(
      Layer.provide(NodeCryptoLayer.layer),
      Layer.provide(RelayConfiguration.layer(config)),
      Layer.provide(
        Layer.succeed(ApnsDeliveryQueue.ApnsDeliveryQueueSender, {
          send: () => Effect.fail(senderCause),
        }),
      ),
    );

    return Effect.gen(function* () {
      const queue = yield* ApnsDeliveryQueue.ApnsDeliveryQueue;
      const error = yield* Effect.flip(
        queue.enqueuePushNotification({
          userId: "user-1",
          deviceId: "device-1",
          token: "push-token",
          notification: {
            title: "Thread",
            body: "Input: Project",
            environmentId: "env-1",
            threadId: "thread-1",
            deepLink: "/threads/env-1/thread-1",
          },
        }),
      );

      expect(error).toMatchObject({
        _tag: "ApnsDeliveryQueueSendError",
        operation: "send",
        jobId: expect.any(String),
        kind: "push_notification",
        userId: "user-1",
        deviceId: "device-1",
        cause: senderCause,
      });
      expect(senderCause.cause).toBe(cause);
      expect(error.message).toBe(
        "Failed to enqueue APNs push notification delivery during send for device device-1.",
      );
    }).pipe(Effect.provide(layer));
  });

  it.effect("bounds Live Activity alert copy before signing the queue job", () => {
    const sent: SignedApnsDeliveryJob[] = [];
    const layer = ApnsDeliveryQueue.layer.pipe(
      Layer.provide(NodeCryptoLayer.layer),
      Layer.provide(RelayConfiguration.layer(config)),
      Layer.provide(
        Layer.succeed(ApnsDeliveryQueue.ApnsDeliveryQueueSender, {
          send: (job) =>
            Effect.sync(() => {
              sent.push(job);
            }),
        }),
      ),
    );

    return Effect.gen(function* () {
      const queue = yield* ApnsDeliveryQueue.ApnsDeliveryQueue;
      yield* queue.enqueueLiveActivity({
        userId: "user-1",
        deviceId: "device-1",
        kind: "live_activity_update",
        token: "activity-token",
        aggregate: {
          title: "T3 Code",
          subtitle: "Agent work in progress",
          activeCount: 1,
          updatedAt: "2026-05-25T00:00:00.000Z",
          activities: [
            {
              environmentId: EnvironmentId.make("env-1"),
              threadId: ThreadId.make("thread-1"),
              projectTitle: "Project",
              threadTitle: "Thread",
              modelTitle: "gpt-5.4",
              phase: "running",
              status: "Working",
              updatedAt: "2026-05-25T00:00:00.000Z",
              deepLink: "/threads/env-1/thread-1",
            },
          ],
        },
        alert: {
          title: "t".repeat(1_000),
          body: "b".repeat(1_000),
        },
      });

      expect(sent[0]?.payload.alert?.title).toHaveLength(120);
      expect(sent[0]?.payload.alert?.body).toHaveLength(120);
    }).pipe(Effect.provide(layer));
  });

  it.effect("rejects an oversized queue job before invoking the sender", () => {
    let sendCount = 0;
    const layer = ApnsDeliveryQueue.layer.pipe(
      Layer.provide(NodeCryptoLayer.layer),
      Layer.provide(RelayConfiguration.layer(config)),
      Layer.provide(
        Layer.succeed(ApnsDeliveryQueue.ApnsDeliveryQueueSender, {
          send: () =>
            Effect.sync(() => {
              sendCount += 1;
            }),
        }),
      ),
    );

    return Effect.gen(function* () {
      const queue = yield* ApnsDeliveryQueue.ApnsDeliveryQueue;
      const error = yield* Effect.flip(
        queue.enqueuePushNotification({
          userId: "user-1",
          deviceId: "device-1",
          token: "t".repeat(AUTH_CREDENTIAL_MAX_LENGTH + 1),
          notification: {
            title: "Thread",
            body: "Input: Project",
            environmentId: "env-1",
            threadId: "thread-1",
            deepLink: "/threads/env-1/thread-1",
          },
        }),
      );

      expect(error.operation).toBe("validate-job");
      expect(sendCount).toBe(0);
    }).pipe(Effect.provide(layer));
  });
});
