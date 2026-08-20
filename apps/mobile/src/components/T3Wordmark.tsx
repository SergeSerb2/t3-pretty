import { Image } from "expo-image";

const T3_PRETTY_MARK = require("../../assets/t3-pretty-mark.png");
/** Pixel size of `assets/pretty/t3-pretty-mark.png`. */
const T3_PRETTY_MARK_ASPECT_RATIO = 304 / 256;

/**
 * The "T3" brand mark, matching the desktop sidebar lockup.
 * Width derives from the generated mark's aspect ratio.
 * Full-color on purpose: the generated mark is the product lockup, not a
 * theme-tinted monochrome glyph.
 */
export function T3Wordmark(props: { readonly height: number }) {
  return (
    <Image
      accessibilityLabel="T3"
      contentFit="contain"
      source={T3_PRETTY_MARK}
      style={{
        height: props.height,
        width: props.height * T3_PRETTY_MARK_ASPECT_RATIO,
      }}
    />
  );
}
