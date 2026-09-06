import type { EnvironmentAutomation } from "@t3tools/client-runtime/state/automations";
import type { EnvironmentId, ThreadAutomationRun } from "@t3tools/contracts";
import { automationRunTriggerLabel } from "@t3tools/shared/automationSchedule";
import { useNavigate } from "@tanstack/react-router";
import { BotIcon } from "lucide-react";
import { memo } from "react";

import { automationEnvironment } from "../../state/automations";
import { useEnvironmentQuery } from "../../state/query";

/**
 * Slim strip above the transcript of a run thread naming the automation and
 * what triggered it. Sits first in ChatView's absolute banner stack so the
 * provider/error banners stack under it; the transcript is inset by `h-7`.
 */
export const AutomationRunBanner = memo(function AutomationRunBanner({
  environmentId,
  automation,
  automationRun,
}: {
  environmentId: EnvironmentId;
  automation: EnvironmentAutomation;
  automationRun: ThreadAutomationRun;
}) {
  const navigate = useNavigate();
  const run = useEnvironmentQuery(
    automationEnvironment.getRun({ environmentId, input: { runId: automationRun.runId } }),
  );
  const trigger = run.data?.trigger;
  return (
    <div className="pointer-events-auto flex h-7 items-center gap-2 border-b border-border/60 bg-muted/30 px-4 text-xs text-muted-foreground">
      <BotIcon aria-hidden className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate">
        Run of <span className="font-medium text-foreground">{automation.name}</span>
        {trigger ? ` · ${automationRunTriggerLabel(trigger)}` : ""}
      </span>
      <button
        type="button"
        className="ml-auto shrink-0 cursor-pointer font-medium text-foreground/80 hover:text-foreground"
        onClick={() =>
          void navigate({
            to: "/automations/$environmentId/$automationId",
            params: { environmentId, automationId: automation.id },
          })
        }
      >
        Open automation
      </button>
    </div>
  );
});
