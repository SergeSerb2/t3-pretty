import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import {
  SourceControlProviderKind as SourceControlProviderKindSchema,
  type SourceControlProviderKind,
} from "@t3tools/contracts";

const FALLBACK_COOLDOWN = Duration.seconds(30);
const MAX_FALLBACK_COOLDOWN = Duration.minutes(15);
export const SOURCE_CONTROL_RATE_LIMIT_CAPACITY = 512;
const SOURCE_CONTROL_HOST_MAX_LENGTH = 253;

interface RateLimitKey {
  readonly provider: SourceControlProviderKind;
  readonly host: string;
}

interface RateLimitLease extends RateLimitKey {
  readonly lease: number;
}

interface RateLimitEntry {
  readonly attempt: number;
  readonly generation: number;
  readonly retryAt: number;
}

export class SourceControlRateLimitPausedError extends Schema.TaggedErrorClass<SourceControlRateLimitPausedError>()(
  "SourceControlRateLimitPausedError",
  {
    provider: SourceControlProviderKindSchema,
    host: Schema.String,
    retryAt: Schema.Number,
  },
) {
  get detail(): string {
    return `${this.provider} requests to ${this.host} are paused until the rate limit resets.`;
  }

  override get message(): string {
    return this.detail;
  }
}

export class SourceControlRateLimit extends Context.Service<
  SourceControlRateLimit,
  {
    readonly check: (
      key: RateLimitKey,
      options?: { readonly allowPaused: boolean },
    ) => Effect.Effect<number, SourceControlRateLimitPausedError>;
    readonly recordRateLimit: (
      input: RateLimitLease & { readonly retryAt?: number | undefined },
    ) => Effect.Effect<void>;
    readonly recordSuccess: (input: RateLimitLease) => Effect.Effect<void>;
  }
>()("t3/sourceControl/SourceControlRateLimit") {}

function normalizedHost(host: string): string {
  return host.trim().toLowerCase().slice(0, SOURCE_CONTROL_HOST_MAX_LENGTH);
}

function normalizedKey(key: RateLimitKey): string {
  return `${key.provider}\0${normalizedHost(key.host)}`;
}

function setBoundedEntry(
  current: ReadonlyMap<string, RateLimitEntry>,
  key: string,
  entry: RateLimitEntry,
): ReadonlyMap<string, RateLimitEntry> {
  const next = new Map(current);
  next.delete(key);
  if (next.size >= SOURCE_CONTROL_RATE_LIMIT_CAPACITY) {
    const oldest = next.keys().next().value;
    if (oldest !== undefined) next.delete(oldest);
  }
  next.set(key, entry);
  return next;
}

function fallbackCooldownMs(attempt: number): number {
  return Math.min(
    Duration.toMillis(FALLBACK_COOLDOWN) * 2 ** Math.max(0, attempt - 1),
    Duration.toMillis(MAX_FALLBACK_COOLDOWN),
  );
}

export function retryAtFromHeader(value: string | undefined, now: number): number | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (/^\d+$/u.test(normalized)) {
    const seconds = Number(normalized);
    const retryAt = now + seconds * 1_000;
    return Number.isSafeInteger(retryAt) ? retryAt : undefined;
  }
  const retryAt = Date.parse(normalized);
  return Number.isFinite(retryAt) && retryAt > now ? retryAt : undefined;
}

export const make = Effect.gen(function* () {
  const entries = yield* Ref.make<ReadonlyMap<string, RateLimitEntry>>(new Map());

  const check: SourceControlRateLimit["Service"]["check"] = Effect.fn(
    "SourceControlRateLimit.check",
  )(function* (input, options) {
    const now = yield* Clock.currentTimeMillis;
    const entry = (yield* Ref.get(entries)).get(normalizedKey(input));
    if (entry !== undefined && entry.retryAt > now && options?.allowPaused !== true) {
      return yield* new SourceControlRateLimitPausedError({
        provider: input.provider,
        host: normalizedHost(input.host),
        retryAt: entry.retryAt,
      });
    }
    return entry?.generation ?? 0;
  });

  const recordRateLimit: SourceControlRateLimit["Service"]["recordRateLimit"] = Effect.fn(
    "SourceControlRateLimit.recordRateLimit",
  )(function* (input) {
    const now = yield* Clock.currentTimeMillis;
    yield* Ref.update(entries, (current) => {
      const key = normalizedKey(input);
      const previous = current.get(key);
      if (previous !== undefined && previous.generation > input.lease) {
        if (previous.retryAt <= now && (input.retryAt === undefined || input.retryAt <= now)) {
          return current;
        }
        const retryAt =
          input.retryAt !== undefined && input.retryAt > previous.retryAt
            ? input.retryAt
            : previous.retryAt;
        if (retryAt === previous.retryAt) return current;
        return setBoundedEntry(current, key, { ...previous, retryAt });
      }

      const attempt = (previous?.attempt ?? 0) + 1;
      const proposedRetryAt =
        input.retryAt !== undefined && input.retryAt > now
          ? input.retryAt
          : now + fallbackCooldownMs(attempt);
      const retryAt =
        previous !== undefined && previous.retryAt > now
          ? Math.max(previous.retryAt, proposedRetryAt)
          : proposedRetryAt;
      return setBoundedEntry(current, key, {
        attempt,
        generation: Math.max(previous?.generation ?? 0, input.lease) + 1,
        retryAt,
      });
    });
  });

  const recordSuccess: SourceControlRateLimit["Service"]["recordSuccess"] = Effect.fn(
    "SourceControlRateLimit.recordSuccess",
  )(function* (input) {
    const now = yield* Clock.currentTimeMillis;
    yield* Ref.update(entries, (current) => {
      const key = normalizedKey(input);
      const previous = current.get(key);
      if (previous === undefined || previous.generation !== input.lease || previous.retryAt > now) {
        return current;
      }
      return setBoundedEntry(current, key, {
        attempt: 0,
        generation: previous.generation,
        retryAt: 0,
      });
    });
  });

  return SourceControlRateLimit.of({ check, recordRateLimit, recordSuccess });
});

export const layer = Layer.effect(SourceControlRateLimit, make);
