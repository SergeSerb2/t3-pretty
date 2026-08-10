import { useAtomSet, useAtomValue } from "@effect/atom-react";
import Constants from "expo-constants";
import { AsyncResult } from "effect/unstable/reactivity";
import { useEffect, useRef, useState } from "react";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import {
  compareAppVersions,
  isAnnounceableAppVersion,
  resolveWhatsNewDecision,
} from "./changelog.logic";
import { CHANGELOG_RELEASES, type ChangelogRelease } from "./changelogData";
import { registerWhatsNewPresenter } from "./whatsNewController";
import { WhatsNewSheet } from "./WhatsNewSheet";

interface WhatsNewPresentation {
  readonly releases: readonly ChangelogRelease[];
  readonly announceUpdate: boolean;
}

/**
 * Shows the What's New sheet once after the app updates past releases the
 * user hasn't seen, and on demand (Settings → What's New) with the full
 * changelog. Fresh installs and dev builds stay silent; the seen marker
 * persists on dismissal via mobile preferences. Mirrors the web WhatsNewHost.
 */
export function WhatsNewHost() {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const [presentation, setPresentation] = useState<WhatsNewPresentation | null>(null);
  const [open, setOpen] = useState(false);
  const decidedRef = useRef(false);

  const currentVersion = Constants.expoConfig?.version ?? "0.0.0";

  useEffect(
    () =>
      registerWhatsNewPresenter(() => {
        if (CHANGELOG_RELEASES.length === 0) {
          return;
        }
        setPresentation({ releases: CHANGELOG_RELEASES, announceUpdate: false });
        setOpen(true);
      }),
    [],
  );

  useEffect(() => {
    if (decidedRef.current || !AsyncResult.isSuccess(preferencesResult)) {
      return;
    }
    decidedRef.current = true;
    const preferences = preferencesResult.value;
    const decision = resolveWhatsNewDecision({
      currentVersion,
      lastSeenVersion: preferences.lastSeenChangelogVersion ?? null,
      // Any persisted preference predating the marker means this device is an
      // upgrade, not a fresh install.
      hasExistingInstallData: Object.keys(preferences).length > 0,
      releases: CHANGELOG_RELEASES,
    });
    if (decision.acknowledgeVersion !== null) {
      savePreferences({ lastSeenChangelogVersion: decision.acknowledgeVersion });
    }
    if (decision.releases.length > 0) {
      setPresentation({ releases: decision.releases, announceUpdate: true });
      setOpen(true);
    }
  }, [currentVersion, preferencesResult, savePreferences]);

  const handleClose = () => {
    // Persist only forward movement so a downgraded build can never mark an
    // already-seen release as unseen.
    if (isAnnounceableAppVersion(currentVersion) && AsyncResult.isSuccess(preferencesResult)) {
      const stored = preferencesResult.value.lastSeenChangelogVersion ?? null;
      if (stored === null || (compareAppVersions(currentVersion, stored) ?? 0) > 0) {
        savePreferences({ lastSeenChangelogVersion: currentVersion });
      }
    }
    setOpen(false);
  };

  if (presentation === null) {
    return null;
  }

  return (
    <WhatsNewSheet
      open={open}
      releases={presentation.releases}
      announceUpdate={presentation.announceUpdate}
      onClose={handleClose}
    />
  );
}
