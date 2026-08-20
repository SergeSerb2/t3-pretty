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

// Kimi runs both full-access modes in the same unrestricted session; they
// differ only in whether Kimi can stop to ask questions. Listed in ascending
// order of access: "Yolo" may ask, "Full access" never does.
const kimiRuntimeModeConfig: Partial<Record<RuntimeMode, RuntimeModeOption>> = {
  yolo: {
    label: "Yolo",
    description: "Full access. Can stop to ask questions.",
    icon: SparklesIcon,
  },
  "full-access": {
    label: "Full access",
    description: "Full access. Never stops to ask questions.",
    icon: LockOpenIcon,
  },
};

// "yolo" is Kimi-only; other providers never offer it.
const genericRuntimeModeOptions = (Object.keys(runtimeModeConfig) as RuntimeMode[]).filter(
  (mode) => mode !== "yolo",
);
const kimiRuntimeModeOptions: RuntimeMode[] = ["approval-required", "yolo", "full-access"];

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
