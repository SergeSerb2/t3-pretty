import type { AutomationRunTrigger, AutomationTrigger } from "@t3tools/contracts";
import { ClockIcon, GitBranchIcon, HandIcon, WebhookIcon, ZapIcon } from "lucide-react";

import { automationTriggerIcon } from "./automations.logic";

const ICONS = {
  clock: ClockIcon,
  hand: HandIcon,
  zap: ZapIcon,
  webhook: WebhookIcon,
  git: GitBranchIcon,
} as const;

export function AutomationTriggerIcon({
  type,
  className,
}: {
  type: AutomationTrigger["type"] | AutomationRunTrigger["type"];
  className?: string;
}) {
  const Icon = ICONS[automationTriggerIcon(type)];
  return <Icon aria-hidden className={className} />;
}
