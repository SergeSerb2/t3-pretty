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

// Kimi names its full-access modes after the CLI: "Auto" never stops to ask,
// "Yolo" runs the same full-access session but can stop to ask questions.
const kimiRuntimeModeConfig: Partial<Record<RuntimeMode, RuntimeModeOption>> = {
  "full-access": {
    label: "Auto",
    description: "Full access. Never stops to ask questions.",
    icon: LockOpenIcon,
  },
  yolo: {
    label: "Yolo",
    description: "Full access. Can stop to ask questions.",
    icon: SparklesIcon,
  },
};

// "yolo" is Kimi-only; other providers never offer it.
const genericRuntimeModeOptions = (Object.keys(runtimeModeConfig) as RuntimeMode[]).filter(
  (mode) => mode !== "yolo",
);
const kimiRuntimeModeOptions: RuntimeMode[] = ["approval-required", "full-access", "yolo"];

export function runtimeModeOptionsForProvider(
  provider: ProviderDriverKind,
): ReadonlyArray<RuntimeMode> {
  return provider === "kimi" ? kimiRuntimeModeOptions : genericRuntimeModeOptions;
}

export function resolveRuntimeModeOption(
  provider: ProviderDriverKind,
  mode: RuntimeMode,
): RuntimeModeOption {
  if (provider === "kimi") {
    return kimiRuntimeModeConfig[mode] ?? runtimeModeConfig[mode];
  }
  return runtimeModeConfig[mode];
}
