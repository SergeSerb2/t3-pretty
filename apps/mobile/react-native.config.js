// iOS already renders through Pretty's Fabric markdown module
// (`SelectableMarkdownText.ios.tsx`). Linking Enriched's pod as well
// collides in CocoaPods' flattened header map: Enriched's
// MarkdownParserBridge.mm includes "MD4CParser.hpp" and then uses
// Markdown::Md4cFlags / Markdown::MD4CParser, but the map resolves that
// basename to nitro-markdown's NitroMarkdown::MD4CParser. Both pods also
// export md_parse. Android keeps Enriched linked; CMake include paths do
// not flatten headers the same way.
module.exports = {
  dependencies: {
    "react-native-enriched-markdown": {
      platforms: {
        ios: null,
      },
    },
  },
};
