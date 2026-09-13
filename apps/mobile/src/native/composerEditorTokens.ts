import {
  collectComposerInlineTokens,
  type CollectComposerInlineTokensOptions,
  type ComposerInlineToken,
} from "@t3tools/shared/composerInlineTokens";

/**
 * Native chips are presentation only; the source text remains authoritative.
 * A long valid draft can contain tens of thousands of tokens, which would
 * otherwise create the same number of native attachments and rendered images.
 */
export const NATIVE_COMPOSER_INLINE_TOKEN_MAX_COUNT = 256;

export function collectNativeComposerInlineTokens(
  text: string,
  options: CollectComposerInlineTokensOptions = {},
): ReadonlyArray<ComposerInlineToken> {
  const tokens = collectComposerInlineTokens(text, options);
  return tokens.length <= NATIVE_COMPOSER_INLINE_TOKEN_MAX_COUNT
    ? tokens
    : tokens.slice(0, NATIVE_COMPOSER_INLINE_TOKEN_MAX_COUNT);
}
