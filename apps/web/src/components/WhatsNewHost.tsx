import { useEffect, useState } from "react";

import { APP_VERSION } from "../branding";
import {
  advanceLastSeenChangelogVersion,
  hasExistingInstallData,
  readLastSeenChangelogVersion,
  resolveWhatsNewDecision,
  writeLastSeenChangelogVersion,
} from "../changelog/changelog.logic";
import { CHANGELOG_RELEASES, type ChangelogRelease } from "../changelog/changelogData";
import { useWhatsNewStore } from "../changelog/whatsNewStore";
import { WhatsNewDialog } from "./WhatsNewDialog";

interface WhatsNewPresentation {
  readonly releases: readonly ChangelogRelease[];
  readonly announceUpdate: boolean;
}

/**
 * Shows the What's New dialog once after the app updates past releases the
 * user hasn't seen, and on demand (settings, command palette) with the full
 * changelog. Fresh installs and dev builds stay silent automatically, installs
 * that predate the seen marker catch up from the rollout baseline, and the
 * marker is persisted when the dialog is dismissed.
 */
export function WhatsNewHost() {
  const [presentation, setPresentation] = useState<WhatsNewPresentation | null>(null);
  const [open, setOpen] = useState(false);
  const manuallyOpened = useWhatsNewStore((state) => state.manuallyOpened);
  const closeWhatsNew = useWhatsNewStore((state) => state.closeWhatsNew);

  useEffect(() => {
    const decision = resolveWhatsNewDecision({
      currentVersion: APP_VERSION,
      lastSeenVersion: readLastSeenChangelogVersion(),
      hasExistingInstallData: hasExistingInstallData(),
      releases: CHANGELOG_RELEASES,
    });
    if (decision.acknowledgeVersion !== null) {
      writeLastSeenChangelogVersion(decision.acknowledgeVersion);
    }
    if (decision.releases.length > 0) {
      setPresentation({ releases: decision.releases, announceUpdate: true });
      setOpen(true);
    }
  }, []);

  useEffect(() => {
    if (manuallyOpened && CHANGELOG_RELEASES.length > 0) {
      setPresentation({ releases: CHANGELOG_RELEASES, announceUpdate: false });
      setOpen(true);
    }
  }, [manuallyOpened]);

  if (presentation === null) {
    return null;
  }

  return (
    <WhatsNewDialog
      releases={presentation.releases}
      open={open}
      announceUpdate={presentation.announceUpdate}
      currentVersion={APP_VERSION}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          return;
        }
        advanceLastSeenChangelogVersion(APP_VERSION);
        setOpen(false);
        closeWhatsNew();
      }}
    />
  );
}
