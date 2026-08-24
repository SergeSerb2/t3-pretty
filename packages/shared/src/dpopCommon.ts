import * as Schema from "effect/Schema";

export const DPOP_JWK_COORDINATE_MAX_LENGTH = 128;
export const DPOP_METHOD_MAX_LENGTH = 32;
export const DPOP_URL_MAX_LENGTH = 8_192;
export const DPOP_IDENTIFIER_MAX_LENGTH = 512;
export const DPOP_ACCESS_TOKEN_MAX_LENGTH = 16_384;

export const DpopPublicJwk = Schema.Struct({
  kty: Schema.Literal("EC"),
  crv: Schema.Literal("P-256"),
  x: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(DPOP_JWK_COORDINATE_MAX_LENGTH)),
  y: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(DPOP_JWK_COORDINATE_MAX_LENGTH)),
});
export type DpopPublicJwk = typeof DpopPublicJwk.Type;

export function normalizeDpopHtu(url: string): string | null {
  if (url.length === 0 || url.length > DPOP_URL_MAX_LENGTH) {
    return null;
  }
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    const normalized = parsed.toString();
    return normalized.length <= DPOP_URL_MAX_LENGTH ? normalized : null;
  } catch {
    return null;
  }
}
