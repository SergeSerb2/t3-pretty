# T3 Pretty upstream integration report

- Parent nightly: `v0.0.34-nightly.20260812.1077`
- Previously integrated parent nightly: `v0.0.34-nightly.20260811.1067`
- Conflict resolver: `gpt-5.6-sol` with `xhigh` reasoning

## T3 Pretty changes preserved at conflict boundaries

- `apps/mobile/app.config.ts` — T3 Pretty mobile versions continue to follow the fork release train, including environment override support and iOS-safe removal of prerelease suffixes.
- `apps/mobile/app.config.ts` — T3 Pretty does not inherit the parent app's independent static version identity.
- `apps/mobile/src/components/ControlPill.tsx` — ControlPill retains the fork-only loading prop used to represent in-flight composer sends.
- `apps/mobile/src/components/ControlPill.tsx` — Loading continues to preserve the primary fill instead of using disabled chrome, while ComposerSendIconSlot swaps the icon for progress UI.
- `apps/mobile/src/components/ControlPill.tsx` — A loading control remains non-interactive to prevent repeated composer dispatches.
- `apps/mobile/src/components/ControlPill.tsx` — Accessibility continues to expose the in-flight state as busy without presenting loading as the explicit disabled chrome state.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Preserved T3 Pretty's memoized composer editor text styling using the fork's body text and foreground color.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Preserved the focus-aware layout-transition suppression that avoids reloading the iOS 26+ keyboard session while the UITextView remains focused.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Preserved tracking of the previous focus state so the composer still animates its initial focus/blur expand-collapse morph.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — World Scenery attribution remains docked below the composer in a measured, keyboard-aware strip, preventing the credit from covering send/stop controls while retaining safe-area clearance.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — T3 Pretty's real ThreadFeed footer remains the authoritative resting composer clearance, including measured overlay-height updates that keep the latest thread rows above the chat box.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — Stable KeyboardStickyView style and offset identities plus non-collapsible native views are retained to prevent iOS keyboard-session loss during streaming renders.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — Fork-specific queued-message delivery state remains wired into ThreadComposer through headQueuedMessageId, isHeadQueuedMessageRetrying, and isDeliveringQueuedMessage.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — Automatic-content-inset compensation continues through T3 Pretty's ThreadFeed footer architecture rather than double-counting the composer through an animated resting inset.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — The empty-to-filled list remount continues to reapply the current non-zero composer/end inset before initial positioning, preventing the thread end from resting behind the chat box.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — T3 Pretty's fork-specific keyboard-padding behavior remains documented as re-reporting through onContentInsetChange.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — The list still distinguishes empty and filled feeds so the intended remount and initial end positioning occur.
- `apps/web/package.json` — Preserved T3 Pretty's direct @lezer/highlight dependency and its associated highlighting support.
- `apps/web/src/components/settings/ThemeEditorPanel.tsx` — The theme editor retains its per-theme sidebar artwork toggle and associated state update behavior.
- `apps/web/src/components/settings/ThemeEditorPanel.tsx` — The toggle continues to use the fork-specific “T3 Pretty environment artwork” branding instead of the former parent branding.
- `docs/README.md` — The T3 Pretty World Scenery user documentation remains linked from the main documentation index.
- `docs/user/thread-sidebar.md` — Preserved the phone Home-list World Scenery behavior, including frosted cards and plates over the landscape photo.
- `docs/user/thread-sidebar.md` — Preserved the accessibility fallback to solid rows when World Scenery is disabled or iOS Reduce Transparency is enabled.
- `packages/shared/src/sourceControl.test.ts` — Remote-helper URL syntax such as hg::https://... remains rejected rather than misclassified.
- `packages/shared/src/sourceControl.test.ts` — Slash-separated non-git user paths remain rejected.
- `packages/shared/src/sourceControl.test.ts` — SCP-style remotes continue to support optional usernames and username-less host:path forms.
- `pnpm-lock.yaml` — Kept apps/web's direct @lezer/highlight dependency at specifier ^1.2.3 and resolved version 1.2.3.

## Parent changes integrated at conflict boundaries

- `apps/mobile/src/components/ControlPill.tsx` — ControlPill now accepts and applies the upstream className customization prop.
- `apps/mobile/src/components/ControlPill.tsx` — activateOnPressIn now invokes the action at press-in time when requested.
- `apps/mobile/src/components/ControlPill.tsx` — The upstream gesture ref and deferred press-out reset prevent the same physical gesture from invoking onPress twice.
- `apps/mobile/src/components/ControlPill.tsx` — Normal controls retain release-time onPress behavior when activateOnPressIn is not enabled.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — The composer now calls onEditorFocusChange(false) when the editor blurs.
- `apps/mobile/src/features/threads/ThreadComposer.tsx` — Updated the handleBlur callback dependency list to include onEditorFocusChange.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — Added end-follow tracking and the animated scroll-to-end control, including liquid-glass styling where supported and the standard ControlPill fallback.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — Integrated Android stale-keyboard quarantine support via AppState, keyboard visibility/height state, owned-input focus recovery, and conditional KeyboardStickyView translation.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — Integrated the upstream platform-specific safe-area timing: Android follows keyboard visibility while iOS follows composer focus/expansion to avoid a post-animation inset snap.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — Integrated window/header measurements used to size pending user-input cards.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — Integrated shared-value pending-user-input collapse/expand choreography, iOS card-coverage inset animation, deterministic end re-pinning, and keyboard dismissal on collapse.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — Kept ThreadComposer mounted but hidden while a user-input request owns the composer slot, preserving draft and editor state.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — Integrated upstream reanimated timing primitives, color-scheme support, and liquid-glass dependencies.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — listMountKey now uses the environment-scoped feedThreadKey rather than the bare threadId, preventing environments with identical thread IDs from sharing stale list mount identity.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — The comment retains the upstream rationale that inset restoration must occur in a layout effect before the remounted list's one-shot initial positioning tick.
- `apps/web/package.json` — Integrated the parent nightly's catalog-managed @noble/hashes dependency.
- `docs/README.md` — Added the parent nightly's Review usage documentation link to the Using T3 Code section.
- `docs/user/thread-sidebar.md` — Documented Dev and Nightly environment artwork in the sidebar and send button.
- `docs/user/thread-sidebar.md` — Documented the Artwork, Version pill, and None environment-identification settings.
- `docs/user/thread-sidebar.md` — Documented built-in-theme artwork recoloring and the Version pill fallback for custom themes.
- `docs/user/thread-sidebar.md` — Documented thread-title regeneration, its in-progress disabled state, and its server-version compatibility gate.
- `packages/shared/src/sourceControl.test.ts` — Added coverage for the standard ssh.dev.azure.com SCP-style Azure DevOps clone URL.
- `packages/shared/src/sourceControl.test.ts` — Added coverage for ssh:// Azure DevOps URLs with an explicit port.
- `packages/shared/src/sourceControl.test.ts` — Added coverage for the legacy vs-ssh.visualstudio.com Azure DevOps SSH host.
- `pnpm-lock.yaml` — Added apps/web's catalog-based @noble/hashes dependency resolved to version 1.8.0.

## Parent changes intentionally omitted

- `apps/mobile/app.config.ts` — Bump the static Expo app version from 1.0.2 to 1.0.3.. Reason: T3 Pretty intentionally derives this value from its own release train via resolveMobileAppVersion(); adopting the parent static version would overwrite the fork's mobile versioning and release identity. The fork's release process supplies its corresponding version independently.
- `apps/mobile/src/features/threads/ThreadDetailScreen.tsx` — The upstream ref-driven resting composer inset path using composerOverlayRef, useKeyboardChatComposerInset, and nativeInsetOvercount.. Reason: T3 Pretty intentionally moved resting composer clearance into ThreadFeed's real list footer because the animated contentInset path can leave LegendList's end position ahead of the visible inset and hide the newest rows under the chat box. Reintroducing that path would double-count the composer and regress the fork fix; upstream's new questionnaire-only dynamic coverage is instead composed on top of the fork's zero shared inset.
- `apps/mobile/src/features/threads/ThreadFeed.tsx` — The upstream comment's claim that useKeyboardChatComposerInset deduplicates by height and never re-reports the composer inset after remount.. Reason: T3 Pretty's side explicitly documents its fork-specific keyboard path as re-reporting through onContentInsetChange. Retaining the upstream claim would misdocument the fork architecture; no upstream runtime behavior is omitted.
- `apps/web/src/components/settings/ThemeEditorPanel.tsx` — Upstream removal of the renderSidebarArtworkToggle helper and its sidebar artwork control.. Reason: Removing this control would regress T3 Pretty’s authoritative sidebar/environment artwork customization. The upstream hunk contains no separable implementation beyond that incompatible deletion.
- `.github/workflows/mobile-eas-production.yml` — parent workflow changes were omitted. Reason: T3 Pretty keeps its trusted sync, signing, release, and security boundary fork-owned
