import type { EnvironmentAutomation } from "@t3tools/client-runtime/state/automations";
import { useState } from "react";

import { appAtomRegistry } from "../../rpc/atomRegistry";
import { environmentThreadShells } from "../../state/threads";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";

/**
 * Delete confirmation shared by the shelf, page, and project settings. The
 * dialog is always mounted, so the thread list is only read while it is open
 * (the count is snapshotted at open time); deleting the automation removes
 * its hidden run threads too.
 */
export function AutomationDeleteDialog({
  automation,
  onOpenChange,
  onConfirm,
}: {
  automation: EnvironmentAutomation | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (automation: EnvironmentAutomation) => void;
}) {
  return (
    <AlertDialog open={automation !== null} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete "{automation?.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            {automation !== null ? (
              <RunThreadCountNote key={automation.id} automation={automation} />
            ) : null}
            This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              if (automation !== null) onConfirm(automation);
              onOpenChange(false);
            }}
          >
            Delete
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function RunThreadCountNote({ automation }: { automation: EnvironmentAutomation }) {
  const [count] = useState(
    () =>
      appAtomRegistry
        .get(environmentThreadShells.allThreadShellsAtom)
        .filter(
          (thread) =>
            thread.environmentId === automation.environmentId &&
            thread.automationRun?.automationId === automation.id,
        ).length,
  );
  return count > 0 ? `Also removes its ${count} run ${count === 1 ? "thread" : "threads"}. ` : null;
}
