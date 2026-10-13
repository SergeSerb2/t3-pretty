import { useState } from "react";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { useSettingsScope } from "./SettingsScopeContext";
import { persistScopedSettingsPatch, planScopedSettingsPatch } from "./scopedSettings";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useScopedSettingsWriteAllowed,
} from "./useScopedSettings";

export function ThreadInstructionsEditor({
  setting,
  label,
  description,
  placeholder,
}: {
  setting: "globalThreadInstructions" | "projectThreadInstructions";
  label: string;
  description: string;
  placeholder: string;
}) {
  const settings = useScopedSettings();
  const mixed = useScopedSettingsMixed([setting]);
  const { scope } = useSettingsScope();
  return (
    <ThreadInstructionsDraft
      key={`${scope.kind}:${scope.environmentIds.join(":")}:${scope.members.map((member) => member.physicalProjectKey).join(":")}`}
      setting={setting}
      label={label}
      description={description}
      placeholder={placeholder}
      savedValue={mixed ? "" : settings[setting]}
      mixed={mixed}
    />
  );
}

function ThreadInstructionsDraft({
  setting,
  label,
  description,
  placeholder,
  savedValue,
  mixed,
}: {
  setting: "globalThreadInstructions" | "projectThreadInstructions";
  label: string;
  description: string;
  placeholder: string;
  savedValue: string;
  mixed: boolean;
}) {
  const { scope, environments } = useSettingsScope();
  const canWrite = useScopedSettingsWriteAllowed();
  const persistServer = useAtomCommand(serverEnvironment.updateSettings, { reportFailure: false });
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const value = draft ?? savedValue;
  const dirty = draft !== null && (mixed || draft.trim() !== savedValue);
  const save = async () => {
    if (!dirty || saving || !canWrite) return;
    const plan = planScopedSettingsPatch(scope, environments, { [setting]: value.trim() });
    if (plan.unavailableReason) {
      setStatus(plan.unavailableReason);
      return;
    }
    setSaving(true);
    setStatus(null);
    try {
      const result = await persistScopedSettingsPatch(plan, persistServer, () => {});
      if (result.failedEnvironments.length > 0) {
        setStatus(
          result.failedEnvironments
            .map(({ label: environmentLabel, message }) => `${environmentLabel}: ${message}`)
            .join(" "),
        );
      } else {
        setDraft(null);
        setStatus("Saved");
      }
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="space-y-3 px-3 pb-4 sm:px-4">
      <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
      <Textarea
        aria-label={label}
        rows={5}
        value={value}
        disabled={!canWrite || saving}
        placeholder={
          mixed
            ? "Instructions differ. Enter guidance to apply to all selected environments."
            : placeholder
        }
        onChange={(event) => {
          setDraft(event.target.value);
          setStatus(null);
        }}
      />
      <div className="flex items-center justify-between gap-3">
        <p role="status" className="text-xs text-muted-foreground">
          {status ??
            (!canWrite
              ? "Connect with settings permission to edit instructions."
              : dirty
                ? "Unsaved changes"
                : "Leave blank for no extra guidance.")}
        </p>
        <Button size="sm" disabled={!dirty || saving || !canWrite} onClick={() => void save()}>
          {saving ? "Saving…" : "Save instructions"}
        </Button>
      </div>
    </div>
  );
}
