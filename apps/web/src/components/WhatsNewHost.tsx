import { useEffect, useState } from "react";

import { APP_VERSION } from "../branding";
import {
  readLastSeenChangelogVersion,
  resolveWhatsNewDecision,
  writeLastSeenChangelogVersion,
} from "../changelog/changelog.logic";
import { CHANGELOG_RELEASES, type ChangelogRelease } from "../changelog/changelogData";
import { WhatsNewDialog } from "./WhatsNewDialog";

/**
 * Shows the What's New dialog once after the app updates past releases the
 * user hasn't seen. First runs and dev builds stay silent; the seen marker is
 * persisted when the dialog is dismissed.
 */
export function WhatsNewHost() {
  const [unseenReleases, setUnseenReleases] = useState<readonly ChangelogRelease[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const decision = resolveWhatsNewDecision({
      currentVersion: APP_VERSION,
      lastSeenVersion: readLastSeenChangelogVersion(),
      releases: CHANGELOG_RELEASES,
    });
    if (decision.acknowledgeVersion !== null) {
      writeLastSeenChangelogVersion(decision.acknowledgeVersion);
    }
    if (decision.releases.length > 0) {
      setUnseenReleases(decision.releases);
      setOpen(true);
    }
  }, []);

  if (unseenReleases.length === 0) {
    return null;
  }

  return (
    <WhatsNewDialog
      releases={unseenReleases}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          writeLastSeenChangelogVersion(APP_VERSION);
        }
      }}
    />
  );
}
