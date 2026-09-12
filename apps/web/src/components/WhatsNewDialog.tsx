import { SparklesIcon } from "lucide-react";
import type { CSSProperties } from "react";
import {
  changelogStaggerIndex,
  formatUpdateSubtitle,
  presentChangelogHistory,
  presentUpdateDigest,
  type PresentedKindGroup,
} from "@t3tools/shared/changelogPresentation";

import type { ChangelogRelease } from "../changelog/changelogData";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";

function KindGroupList({ groups }: { readonly groups: readonly PresentedKindGroup[] }) {
  const showHeadings = groups.length > 1;
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group, groupIndex) => (
        <div key={group.kind} className="flex flex-col gap-3">
          {showHeadings ? (
            <p className="font-medium text-muted-foreground text-sm">{group.heading}</p>
          ) : null}
          <ul className="flex flex-col gap-3.5">
            {group.items.map((item, itemIndex) => (
              <li
                key={`${item.kind}:${item.sourceTitle}:${itemIndex}`}
                className="flex flex-col gap-0.5"
                // Stagger slot for scenery/motion.css; capped so rows below
                // the fold never wait on the ones above.
                style={
                  {
                    "--sc-i": changelogStaggerIndex(groups, groupIndex, itemIndex),
                  } as CSSProperties
                }
              >
                <p className="text-pretty font-medium text-sm leading-snug">{item.title}</p>
                {item.description ? (
                  <p className="text-pretty text-muted-foreground text-sm leading-relaxed">
                    {item.description}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function WhatsNewDialog({
  releases,
  open,
  announceUpdate,
  currentVersion,
  onOpenChange,
}: {
  readonly releases: readonly ChangelogRelease[];
  readonly open: boolean;
  /** True when the dialog announces a fresh update, false when the user
      opened the changelog on demand. */
  readonly announceUpdate: boolean;
  /** The running app version, shown in the update announcement. It can be
      newer than the latest changelog entry (nightlies). */
  readonly currentVersion: string;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const digest = announceUpdate ? presentUpdateDigest(releases) : null;
  const history = announceUpdate ? null : presentChangelogHistory(releases);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup aria-label="What's new" className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <SparklesIcon aria-hidden className="size-4.5 shrink-0 text-primary" />
            <DialogTitle>What’s new</DialogTitle>
          </div>
          <DialogDescription>
            {announceUpdate ? formatUpdateSubtitle(releases, currentVersion) : "Recent updates"}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col">
          {digest ? (
            digest.groups.length === 0 ? (
              <p className="text-pretty text-muted-foreground text-sm leading-relaxed">
                This update is installed. There are no extra notes to show.
              </p>
            ) : (
              <div className="flex flex-col gap-5">
                {digest.headline ? (
                  <p className="text-pretty text-sm leading-relaxed">{digest.headline}</p>
                ) : null}
                <KindGroupList groups={digest.groups} />
                {digest.truncated ? (
                  <p className="text-pretty text-muted-foreground text-sm leading-relaxed">
                    Earlier changes are in Settings → What’s new.
                  </p>
                ) : null}
              </div>
            )
          ) : history !== null && history.length === 0 ? (
            <p className="text-pretty text-muted-foreground text-sm leading-relaxed">
              No recent notes to show.
            </p>
          ) : (
            <div className="flex flex-col">
              {history?.map((day, index) => (
                <div
                  key={day.date}
                  className={cn("flex flex-col gap-4", index > 0 && "mt-5 border-t pt-5")}
                >
                  <p className="font-medium text-sm">{day.label}</p>
                  <KindGroupList groups={day.groups} />
                </div>
              ))}
            </div>
          )}
        </DialogPanel>
        <DialogFooter>
          <DialogClose
            render={
              <Button
                size="sm"
                variant={announceUpdate ? "default" : "outline"}
                className="max-sm:w-full"
              />
            }
          >
            {announceUpdate ? "Continue" : "Close"}
          </DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
