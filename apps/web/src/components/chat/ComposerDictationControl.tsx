import { MicIcon, SquareIcon, XIcon } from "lucide-react";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { DictationPhase } from "./useBrowserDictation";

export function ComposerDictationControl(props: {
  readonly phase: DictationPhase;
  readonly disabled: boolean;
  readonly hostLabel: string | null;
  readonly shortcut: string | undefined;
  readonly onToggle: () => void;
  readonly onCancel: () => void;
}) {
  const recording = props.phase === "recording";
  const busy = props.phase === "preparing" || props.phase === "processing";
  const label = recording ? "Finish dictation" : "Start dictation";
  return (
    <div className="flex shrink-0 items-center gap-1">
      {props.phase !== "idle" ? (
        <>
          <span role="status" className="text-xs text-muted-foreground">
            {recording ? "Listening…" : props.phase === "preparing" ? "Preparing…" : "Cleaning up…"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Cancel dictation"
            title="Cancel dictation (Esc)"
            onPointerDown={(event) => event.preventDefault()}
            onClick={props.onCancel}
          >
            <XIcon className="size-3.5" />
          </Button>
        </>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={label}
              aria-pressed={recording}
              aria-busy={busy}
              disabled={busy || props.disabled}
              className={recording ? "text-destructive" : undefined}
              onPointerDown={(event) => event.preventDefault()}
              onClick={props.onToggle}
            />
          }
        >
          {recording ? <SquareIcon className="size-3.5" /> : <MicIcon className="size-4" />}
        </TooltipTrigger>
        <TooltipPopup>
          {label}
          {props.shortcut ? ` (${props.shortcut})` : ""}
          <div className="text-xs text-muted-foreground">
            {props.hostLabel
              ? `Via ${props.hostLabel}`
              : "Set up Groq on a connected internal host"}
          </div>
        </TooltipPopup>
      </Tooltip>
    </div>
  );
}
