# T3 Pretty upstream integration report

- Parent nightly: `v0.0.46-nightly.20261015.3176`
- Previously integrated parent nightly: `v0.0.46-nightly.20261015.3171`
- Conflict resolver: `gpt-6.1-sol` with `xhigh` reasoning
- 1 file(s) took the fork-side fallback because no model resolution was available; review their omissions below

## T3 Pretty changes preserved at conflict boundaries

- `apps/desktop/package.json` — The desktop product name retains the fork-specific T3 Pretty identity.
- `apps/desktop/scripts/electron-launcher.mjs` — T3 Pretty display-name branding remains intact in both development and production.
- `apps/desktop/scripts/electron-launcher.mjs` — Development continues to use the exact display name "T3 Pretty (Dev)".
- `apps/desktop/src/app/DesktopAppIdentity.test.ts` — kept the fork side wholesale as a fork-side fallback resolution
- `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts` — Linux pre-ready desktop-entry regression coverage continues to require Name=T3 Pretty.
- `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts` — Existing checks for Pretty desktop and icon identifiers, t3code URL handling, and synchronous portal identity preparation remain unchanged.
- `apps/server/src/htmlRender/HtmlRender.ts` — Create the pending-html-render sidecar only for tool-published pages, preserving the distinction from user uploads and drafts.
- `apps/server/src/htmlRender/HtmlRender.ts` — Write the pending marker before the HTML document and retain failure/interruption cleanup of both files.
- `apps/web/index.html` — T3 Pretty document-title branding remains intact.
- `apps/web/index.html` — The existing branded launch splash, accessibility labels, animations, and reduced-motion handling remain unchanged.
- `packages/effect-acp/src/errors.ts` — Retains the 4,096-node diagnostic capacity and the existing iterative collection of issue counts, issue kinds, and maximum path depth.
- `packages/effect-acp/src/errors.ts` — Preserves ACP error-path resource hardening: the new summary helper cannot reintroduce unbounded recursion, branch scanning, or path accumulation.
- `packages/effect-acp/src/protocol.test.ts` — Preserved the fork-added PlatformError dependency for the protocol tests.
- `packages/effect-acp/src/protocol.test.ts` — Preserved the existing Exit import without changing any test bodies.
- `packages/effect-acp/src/protocol.ts` — Byte-oriented wire-line framing, including encoding string chunks before framing and propagating AcpWireLineTooLargeError with maximum and observed byte counts.
- `packages/effect-acp/src/protocol.ts` — Per-line NDJSON decoding with a terminating newline, ACP JSON-RPC error normalization, incoming logging, and decoded-message routing.
- `packages/effect-acp/src/protocol.ts` — EOF processing through wireLineFramer.finish() and the existing termination handling that fails pending requests when input ends or the reader fails.
- `packages/shared/src/htmlRender.test.ts` — Regression coverage requiring older backend markup to receive CSP before executable scripts and to prohibit network connections.
- `packages/shared/src/htmlRender.test.ts` — Regression coverage rejecting failed asset responses and oversized HTML documents before browser consumption.
- `packages/shared/src/htmlRender.test.ts` — Initial-theme coverage for applying the selected palette before scripts, preserving page styles and CSP ordering, ignoring fake or inert theme markers, and bootstrapping older documents.
- `packages/shared/src/htmlRender.test.ts` — Theme-value sanitization coverage preventing style-element breakout and rejecting invalid custom-property names.
- `scripts/build-desktop-artifact.test.ts` — Stable and nightly desktop product-name coverage retains T3 Pretty and T3 Pretty (Nightly).
- `scripts/build-desktop-artifact.test.ts` — Internal stable and nightly product-name coverage retains T3 Pretty Internal and T3 Pretty Internal (Nightly).
- `scripts/build-desktop-artifact.test.ts` — Existing 0.0.17 stable-release coverage remains alongside the new 0.1.0 case.
- `scripts/build-desktop-artifact.test.ts` — The packaging test continues to require the T3 Pretty macOS DMG installer title, protecting fork branding.

## Parent changes integrated at conflict boundaries

- `apps/desktop/package.json` — The desktop product designation advances from Alpha to Beta.
- `apps/desktop/scripts/electron-launcher.mjs` — The production release-stage label advances from Alpha to Beta, yielding "T3 Pretty (Beta)".
- `apps/server/src/htmlRender/HtmlRender.ts` — Adopt the measured result binding used by the return path to publish measured heights and optional outline metadata.
- `apps/web/index.html` — The document title’s release-stage label advances from Alpha to Beta.
- `packages/effect-acp/src/errors.ts` — Adds value-free schema summaries with sanitized path segments and missing, unexpected, wrong-type, or invalid reasons.
- `packages/effect-acp/src/errors.ts` — Retains the three-entry display limit, eight-segment displayed paths, path ellipsis, deduplication, and additional-entry count.
- `packages/effect-acp/src/errors.ts` — Prefers known union-member failures over catch-all members titled "other", retaining catch-all fallback when the examined branch is complete and contains no known members.
- `packages/effect-acp/src/errors.ts` — Preserves the schemaIssueSummary signature and existing issueSummary schema field, requiring no consumer or contract changes.
- `packages/effect-acp/src/protocol.test.ts` — Added the parent’s Logger import.
- `packages/effect-acp/src/protocol.test.ts` — Kept Exit available through its existing import rather than introducing a duplicate declaration.
- `packages/effect-acp/src/protocol.ts` — Use decodeFailureDiagnostics(error) for incoming decode_failed logs, adapted to Pretty's extracted handleLine implementation.
- `packages/shared/src/htmlRender.test.ts` — Outline encoding and reference round-trip tests, including dropping zero-width boxes.
- `packages/shared/src/htmlRender.test.ts` — Outline geometry tests for scaling to client width and measured layout height.
- `packages/shared/src/htmlRender.test.ts` — Validation tests rejecting malformed and unmeasured outlines, returning no boxes without an outline, and including outline content in reference equality.
- `scripts/build-desktop-artifact.test.ts` — The product-name test now covers upstream's 0.1.0 stable-release version, adapted to T3 Pretty branding.

## Parent changes intentionally omitted

- `apps/desktop/src/app/DesktopAppIdentity.test.ts` — every parent change at this file's conflict boundaries (fork-side fallback). Reason: apps/desktop/src/app/DesktopAppIdentity.test.ts was not safe to resolve automatically: Not safe to apply yet. The proposed edits remove both conflict blocks, but the supplied test does not establish whether production now generates T3 Pretty (Beta). Alpha was inherited from BASE, so freezing it could discard a compatible parent stage change; asserting Beta without checking the producer could instead break the tests. Please supply apps/desktop/src/app/DesktopAppIdentity.ts and apps/desktop/src/app/DesktopEnvironment.ts, including their current merge changes, to verify configure/setName, About-panel naming, and default stage selection.
- `apps/desktop/src/app/DesktopPreReadyPlatform.test.ts` — Update the desktop-entry display-name assertion from Name=T3 Code (Alpha) to Name=T3 Code (Beta).. Reason: The parent release-label change would replace the fork's deliberate Name=T3 Pretty branding. Preserve the authoritative fork identity rather than require the parent product name.
- `packages/effect-acp/src/errors.ts` — Exhaustive summary traversal and exact distinct-failure counts beyond the diagnostic budget, including inspection of arbitrarily wide union branches.. Reason: The parent's recursive, unbounded implementation could bypass Pretty's explicit diagnostic resource guard. The merged helper applies the 4,096-node budget iteratively, bounds retained paths, and uses a generic invalid reason when truncation prevents a specific summary. Failures outside that budget are not enumerated or counted.
- `scripts/build-desktop-artifact.test.ts` — Upstream's stable product-name relabeling from T3 Code (Alpha) to T3 Code (Beta).. Reason: Applying the parent label would overwrite the authoritative T3 Pretty desktop identity. The 0.1.0 test case is retained without that branding change.
- `scripts/build-desktop-artifact.test.ts` — Change the expected macOS DMG title from T3 Code (Alpha) to T3 Code (Beta).. Reason: The fork deliberately replaced the parent title with T3 Pretty. Adopting the parent's Beta-branded title would regress that authoritative fork identity.
