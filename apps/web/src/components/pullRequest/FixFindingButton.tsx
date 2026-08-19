import type { ContextMenuItem } from "@t3tools/contracts";
import { HammerIcon } from "lucide-react";
import type { MouseEvent } from "react";

import { readLocalApi } from "~/localApi";

import { Button } from "../ui/button";
import type { PullRequestFixDestination } from "./pullRequestDetail.logic";

export function canOpenFixFindingMenu(input: {
  readonly disabled: boolean;
  readonly pending: boolean;
}): boolean {
  return !input.disabled && !input.pending;
}

export function fixFindingMenuItems(input: {
  readonly thisThreadLabel: string;
  readonly otherThreadLabel: string;
  readonly canFixInThisThread: boolean;
}): readonly ContextMenuItem<PullRequestFixDestination>[] {
  return [
    {
      id: "this-thread",
      label: input.thisThreadLabel,
      disabled: !input.canFixInThisThread,
    },
    { id: "new-thread", label: input.otherThreadLabel },
  ];
}

/** Left-click is the default destination. Right-click offers this thread and another thread. */
export function FixFindingButton({
  label,
  thisThreadLabel = "Fix in this thread",
  otherThreadLabel = "Fix in another thread",
  canFixInThisThread,
  pending,
  disabled,
  onFix,
}: {
  label: string;
  thisThreadLabel?: string;
  otherThreadLabel?: string;
  canFixInThisThread: boolean;
  pending: boolean;
  disabled: boolean;
  onFix: (destination: PullRequestFixDestination) => void;
}) {
  const defaultDestination: PullRequestFixDestination = canFixInThisThread
    ? "this-thread"
    : "new-thread";

  const onContextMenu = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canOpenFixFindingMenu({ disabled, pending })) return;
    const api = readLocalApi();
    if (!api) return;
    try {
      const clicked = await api.contextMenu.show(
        fixFindingMenuItems({
          thisThreadLabel,
          otherThreadLabel,
          canFixInThisThread,
        }),
        { x: event.clientX, y: event.clientY },
      );
      if (clicked === "this-thread" || clicked === "new-thread") onFix(clicked);
    } catch {
      // A menu that could not be shown already spent the gesture.
    }
  };

  return (
    <Button
      size="xs"
      variant="ghost"
      className="shrink-0"
      disabled={disabled}
      onClick={() => onFix(defaultDestination)}
      onContextMenu={(event) => void onContextMenu(event)}
    >
      <HammerIcon className="size-3" />
      {pending ? "Preparing..." : label}
    </Button>
  );
}
