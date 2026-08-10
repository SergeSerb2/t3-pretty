import { SparklesIcon, WrenchIcon, ZapIcon, type LucideIcon } from "lucide-react";

import { APP_BASE_NAME } from "../branding";
import type { ChangelogItemKind, ChangelogRelease } from "../changelog/changelogData";
import { Badge } from "~/components/ui/badge";
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

const KIND_PRESENTATION: Record<
  ChangelogItemKind,
  { label: string; Icon: LucideIcon; tileClass: string; labelClass: string }
> = {
  new: {
    label: "New",
    Icon: SparklesIcon,
    tileClass: "bg-primary/12 text-primary",
    labelClass: "bg-primary/10 text-primary",
  },
  improved: {
    label: "Improved",
    Icon: ZapIcon,
    tileClass: "bg-info/12 text-info-foreground",
    labelClass: "bg-info/10 text-info-foreground",
  },
  fixed: {
    label: "Fixed",
    Icon: WrenchIcon,
    tileClass: "bg-success/12 text-success-foreground",
    labelClass: "bg-success/10 text-success-foreground",
  },
};

const releaseDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeZone: "UTC",
});

function formatReleaseDate(isoDate: string): string | null {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : releaseDateFormatter.format(parsed);
}

export function WhatsNewDialog({
  releases,
  open,
  announceUpdate,
  onOpenChange,
}: {
  readonly releases: readonly ChangelogRelease[];
  readonly open: boolean;
  /** True when the dialog announces a fresh update, false when the user
      opened the changelog on demand. */
  readonly announceUpdate: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const latestVersion = releases[0]?.version;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup aria-label="What's new" className="max-w-md">
        <DialogHeader className="relative overflow-hidden">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(28rem_9rem_at_top_left,color-mix(in_srgb,var(--primary)_14%,transparent),transparent)]"
          />
          <div className="relative flex items-center gap-3.5">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-sm">
              <SparklesIcon className="size-5.5" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <DialogTitle>What’s new</DialogTitle>
              <DialogDescription>
                {announceUpdate && latestVersion
                  ? `${APP_BASE_NAME} has been updated to v${latestVersion}.`
                  : `Recent updates to ${APP_BASE_NAME}.`}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        <DialogPanel className="flex flex-col">
          {releases.map((release, index) => (
            <section
              key={release.version}
              className={cn("flex flex-col gap-3 py-5 first:pt-1", index > 0 && "border-t")}
            >
              <div className="flex items-baseline gap-2">
                <Badge variant="secondary">v{release.version}</Badge>
                {formatReleaseDate(release.date) && (
                  <span className="text-muted-foreground text-xs">
                    {formatReleaseDate(release.date)}
                  </span>
                )}
              </div>
              {release.headline && (
                <p className="text-foreground/90 text-sm leading-relaxed">{release.headline}</p>
              )}
              <ul className="flex flex-col gap-3.5">
                {release.items.map((item) => {
                  const kind = KIND_PRESENTATION[item.kind];
                  return (
                    <li key={item.title} className="flex gap-3">
                      <span
                        className={cn(
                          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg",
                          kind.tileClass,
                        )}
                      >
                        <kind.Icon className="size-4" />
                      </span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-sm leading-tight">{item.title}</span>
                          <span
                            className={cn(
                              "rounded-sm px-1 py-px font-semibold text-[.625rem] uppercase tracking-wide",
                              kind.labelClass,
                            )}
                          >
                            {kind.label}
                          </span>
                        </div>
                        {item.description && (
                          <p className="text-muted-foreground text-sm leading-relaxed">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button size="sm" />}>Got it</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
