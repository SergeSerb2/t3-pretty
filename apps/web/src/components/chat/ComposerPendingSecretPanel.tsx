import { type ApprovalRequestId } from "@t3tools/contracts";
import { type PendingSecretRequest } from "@t3tools/client-runtime/pending-requests";
import { memo, useState } from "react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { ComposerBanner } from "./ComposerBanner";

interface PendingSecretPanelProps {
  request: PendingSecretRequest;
  isResponding: boolean;
  onProvide: (requestId: ApprovalRequestId, value: string) => void;
  onDecline: (requestId: ApprovalRequestId) => void;
}

/**
 * An agent's API key prompt. The value is typed into a password field and
 * sent over its own RPC, never through the composer or the event log.
 */
export const ComposerPendingSecretPanel = memo(function ComposerPendingSecretPanel({
  request,
  isResponding,
  onProvide,
  onDecline,
}: PendingSecretPanelProps) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const canSubmit = trimmed.length > 0 && !isResponding;
  const submit = () => {
    if (!canSubmit) return;
    onProvide(request.requestId, trimmed);
  };

  return (
    <>
      <ComposerBanner.Row>
        <ComposerBanner.Icon />
        <ComposerBanner.Content>
          <span className="shrink-0 font-medium text-muted-foreground">{request.header}</span>
          <span className="min-w-0 flex-1 truncate text-secondary-label">
            Stored as <code className="font-mono text-[11px]">{request.name}</code>
          </span>
        </ComposerBanner.Content>
        <ComposerBanner.Actions>
          <ComposerBanner.Dismiss
            aria-label="Decline without providing a key"
            title="Decline without providing a key"
            disabled={isResponding}
            data-pending-secret-decline
            onClick={() => onDecline(request.requestId)}
          />
        </ComposerBanner.Actions>
      </ComposerBanner.Row>
      <ComposerBanner.Body className="pe-1 pb-1">
        <p className="text-sm text-foreground/85">{request.purpose}</p>
        <p className="mt-1 text-secondary-label text-xs">
          Saved as a sensitive global environment variable on this machine, never in the chat or
          thread history. The agent loads it from a protected file for this session and gets it as
          an environment variable from then on.
        </p>
        <form
          className="mt-2 flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="min-w-0 flex-1 rounded-md border border-border/60 bg-background/70">
            <Input
              type="password"
              autoComplete="off"
              spellCheck={false}
              size="sm"
              placeholder={`Paste your ${request.name}`}
              aria-label={request.header}
              value={value}
              disabled={isResponding}
              onChange={(event) => setValue(event.target.value)}
              data-pending-secret-input
            />
          </div>
          <Button type="submit" size="sm" disabled={!canSubmit} data-pending-secret-submit>
            {isResponding ? "Saving…" : "Save key"}
          </Button>
        </form>
      </ComposerBanner.Body>
    </>
  );
});
