import { useState } from "react";

import { openClerkGate, useCloudUiEnabled } from "../../cloud/clerkGate";
import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button, InlineButton } from "../ui/button";
import { useT3ConnectAccountPage } from "./T3ConnectAccountPages";

interface RemoveT3ConnectEnvironmentDialogProps {
  /** The environment awaiting confirmation; null keeps the dialog closed. */
  readonly environmentLabel: string | null;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}

/**
 * Confirms removing a T3 Connect environment from this device. Removal here
 * leaves the account registration (and its host space) in place, so the dialog
 * says so and links to the account page where it can be deregistered.
 */
export function RemoveT3ConnectEnvironmentDialog(props: RemoveT3ConnectEnvironmentDialogProps) {
  if (useCloudUiEnabled()) return <ConfiguredRemoveT3ConnectEnvironmentDialog {...props} />;

  return (
    <RemoveEnvironmentDialog
      {...props}
      openAccountPage={hasCloudPublicConfig() ? () => openClerkGate({ promptSignIn: true }) : null}
    />
  );
}

function ConfiguredRemoveT3ConnectEnvironmentDialog(props: RemoveT3ConnectEnvironmentDialogProps) {
  const accountPage = useT3ConnectAccountPage();
  return (
    <>
      <RemoveEnvironmentDialog {...props} openAccountPage={accountPage.open} />
      {accountPage.portals}
    </>
  );
}

function RemoveEnvironmentDialog({
  environmentLabel,
  onCancel,
  onConfirm,
  openAccountPage,
}: RemoveT3ConnectEnvironmentDialogProps & { readonly openAccountPage: (() => void) | null }) {
  // Keep the label through the close animation.
  const [shownLabel, setShownLabel] = useState(environmentLabel);
  if (environmentLabel !== null && environmentLabel !== shownLabel) setShownLabel(environmentLabel);

  return (
    <AlertDialog
      open={environmentLabel !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {shownLabel} from this device?</AlertDialogTitle>
          <AlertDialogDescription>
            This forgets its pairing, credentials, and cached threads here.
          </AlertDialogDescription>
          <AlertDialogDescription>
            It stays on your T3 Connect account and keeps its host space. Deregister it in{" "}
            {openAccountPage ? (
              <InlineButton
                onClick={() => {
                  onCancel();
                  openAccountPage();
                }}
              >
                T3 Connect settings
              </InlineButton>
            ) : (
              "T3 Connect settings"
            )}{" "}
            to free it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button variant="destructive" onClick={onConfirm}>
            Remove from this device
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}
