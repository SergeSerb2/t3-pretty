import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  apnsProviderTokenCacheKey,
  makeApnsJwt,
  type ApnsJwtError,
  type ApnsJwtSigningInput,
} from "./apnsJwt.ts";

// APNs requires REUSING the provider token: refreshing it more than roughly
// once per 20 minutes returns 429 TooManyProviderTokenUpdates and drops the
// push (observed live: bursty Live Activity updates got 429'd, leaving stale
// lock-screen state). Reuse each signed JWT for most of its 60-minute
// validity.
export const APNS_JWT_REUSE_SECONDS = 45 * 60;
export const APNS_PROVIDER_TOKEN_CACHE_MAX_ENTRIES = 8;

export class ApnsProviderTokens extends Context.Service<
  ApnsProviderTokens,
  {
    readonly getJwt: (input: ApnsJwtSigningInput) => Effect.Effect<string, ApnsJwtError>;
  }
>()("t3code-relay/agentActivity/ApnsProviderTokens") {}

interface CachedProviderToken {
  readonly jwt: string;
  readonly issuedAtUnixSeconds: number;
}

// Signing is deterministic (RFC 6979) and iat is quantized below, so every
// isolate independently derives the byte-identical token for a window; this
// map only avoids re-signing on every push. No shared storage is needed, and
// no provider token is ever written anywhere.
const isolateTokenCache = new Map<string, CachedProviderToken>();

export function __resetApnsProviderTokenCacheForTest(): void {
  isolateTokenCache.clear();
}

export function __apnsProviderTokenCacheSizeForTest(): number {
  return isolateTokenCache.size;
}

function cacheProviderToken(cacheKey: string, token: CachedProviderToken): void {
  isolateTokenCache.delete(cacheKey);
  isolateTokenCache.set(cacheKey, token);
  while (isolateTokenCache.size > APNS_PROVIDER_TOKEN_CACHE_MAX_ENTRIES) {
    const oldestKey = isolateTokenCache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    isolateTokenCache.delete(oldestKey);
  }
}

// Quantize iat to the reuse window so all isolates agree on it. The token's
// age stays under APNs' 60-minute limit, and the whole fleet rolls to the
// next token at the same instant — one provider-token update per window.
export function quantizedApnsJwtIssuedAt(nowUnixSeconds: number): number {
  return Math.floor(nowUnixSeconds / APNS_JWT_REUSE_SECONDS) * APNS_JWT_REUSE_SECONDS;
}

export const make = () =>
  ApnsProviderTokens.of({
    getJwt: Effect.fnUntraced(function* (input) {
      const issuedAtUnixSeconds = quantizedApnsJwtIssuedAt(input.issuedAtUnixSeconds);
      const cacheKey = apnsProviderTokenCacheKey(input);
      const cached = isolateTokenCache.get(cacheKey);
      if (cached && cached.issuedAtUnixSeconds === issuedAtUnixSeconds) {
        cacheProviderToken(cacheKey, cached);
        return cached.jwt;
      }
      const jwt = yield* makeApnsJwt({ ...input, issuedAtUnixSeconds });
      cacheProviderToken(cacheKey, { jwt, issuedAtUnixSeconds });
      return jwt;
    }),
  });

export const layer = Layer.succeed(ApnsProviderTokens, make());
