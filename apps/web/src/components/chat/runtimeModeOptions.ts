import type { ProviderDriverKind, RuntimeMode } from "@t3tools/contracts";
import { LockIcon, LockOpenIcon, PenLineIcon, SparklesIcon, type LucideIcon } from "lucide-react";

export type RuntimeModeOption = {
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
};

const runtimeModeConfig: Record<RuntimeMode, RuntimeModeOption> = {
  "approval-required": {
    label: "Supervised",
    description: "Ask before commands and file changes.",
    icon: LockIcon,
  },
  "auto-accept-edits": {
    label: "Auto-accept edits",
    description: "Auto-approve edits, ask before other actions.",
    icon: PenLineIcon,
  },
  auto: {
    label: "Auto",
    description: "Supported providers approve routine actions; others still ask.",
    icon: SparklesIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
  yolo: {
    label: "Yolo",
    description: "Allow commands and edits without prompts.",
    icon: LockOpenIcon,
  },
};

// "yolo" is a historical persisted spelling of full-access. Never offer it.
const genericRuntimeModeOptions = (Object.keys(runtimeModeConfig) as RuntimeMode[]).filter(
  (mode) => mode !== "yolo",
);

export function runtimeModeOptionsForProvider(
  _provider: ProviderDriverKind,
): ReadonlyArray<RuntimeMode> {
  return genericRuntimeModeOptions;
}

export function resolveRuntimeModeOption(
  _provider: ProviderDriverKind,
  mode: RuntimeMode,
): RuntimeModeOption {
  return runtimeModeConfig[mode];
}
