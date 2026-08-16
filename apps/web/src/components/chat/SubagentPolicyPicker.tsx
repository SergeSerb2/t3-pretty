/**
 * Composer footer control for per-thread subagent policy.
 *
 * Inherit follows Settings → Agents. Off and On pin the thread. On may also
 * pin a child model; otherwise the global or cheaper sibling is used.
 */
import { useAtomValue } from "@effect/atom-react";
import { useRouter } from "@tanstack/react-router";
import type {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  ScopedThreadRef,
  SubagentChildSelection,
  ThreadSubagentPolicy,
} from "@t3tools/contracts";
import {
  DEFAULT_SUBAGENT_POLICY_SETTINGS,
  DEFAULT_THREAD_SUBAGENT_POLICY,
  resolveSubagentPolicy,
  subagentPolicyBindCaption,
  threadSubagentPolicyOrInherit,
} from "@t3tools/contracts";
import { BotIcon } from "lucide-react";
import { useMemo } from "react";

import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { usePrimarySettings } from "~/hooks/useSettings";
import { getProviderInstanceEntry } from "../../providerInstances";
import { primaryServerProvidersAtom } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { ComposerControl, ComposerControlChevron, ComposerControlIcon } from "./ComposerControl";
import { cn } from "~/lib/utils";

export interface SubagentPolicyPickerProps {
  environmentId: EnvironmentId;
  parentModel: string;
  parentInstanceId: ProviderInstanceId;
  parentDriver: ProviderDriverKind | null;
  threadRef?: ScopedThreadRef | undefined;
  threadPolicy?: ThreadSubagentPolicy | undefined;
  draftId?: DraftId | undefined;
}

function policyLabel(policy: ThreadSubagentPolicy): string {
  if (policy.mode === "off") {
    return "Off";
  }
  if (policy.mode === "on") {
    return policy.child?.model ?? "On";
  }
  return "Inherit";
}

export function SubagentPolicyPicker(props: SubagentPolicyPickerProps) {
  return (
    <Popover>
      <PopoverTrigger
        render={<ComposerControl variant="ghost" className="shrink-0 whitespace-nowrap" />}
      >
        <ComposerControlIcon icon={BotIcon} />
        <span>Agents</span>
        <ComposerControlChevron />
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        className="w-80 max-w-full"
        viewportClassName="py-1.5 [--viewport-inline-padding:--spacing(1.5)]"
      >
        <SubagentPolicyMenuContent {...props} />
      </PopoverPopup>
    </Popover>
  );
}

export function SubagentPolicyMenuContent(props: SubagentPolicyPickerProps) {
  const router = useRouter();
  const settings = usePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const draftPolicy = useComposerDraftStore((store) =>
    props.draftId ? store.getComposerDraft(props.draftId)?.subagentPolicy : undefined,
  );
  const setDraftPolicy = useComposerDraftStore((store) => store.setSubagentPolicy);
  const setThreadPolicy = useAtomCommand(threadEnvironment.setThreadSubagentPolicy, {
    reportFailure: false,
  });

  const current = threadSubagentPolicyOrInherit(props.draftId ? draftPolicy : props.threadPolicy);
  const driver =
    props.parentDriver ??
    getProviderInstanceEntry(serverProviders, props.parentInstanceId)?.driverKind;
  const resolved = useMemo(() => {
    if (driver === undefined) {
      return null;
    }
    return resolveSubagentPolicy({
      global: settings.subagentPolicy ?? DEFAULT_SUBAGENT_POLICY_SETTINGS,
      thread: current,
      parentModel: props.parentModel,
      parentInstanceId: props.parentInstanceId,
      driver,
    });
  }, [current, driver, props.parentInstanceId, props.parentModel, settings.subagentPolicy]);

  const persist = (policy: ThreadSubagentPolicy) => {
    if (props.draftId) {
      setDraftPolicy(props.draftId, policy);
      return;
    }
    if (props.threadRef === undefined) {
      return;
    }
    void setThreadPolicy({
      environmentId: props.environmentId,
      input: { threadId: props.threadRef.threadId, policy },
    });
  };

  const pinChild = (child: SubagentChildSelection | null) => {
    persist({ mode: "on", child });
  };

  return (
    <div className="flex flex-col gap-2 px-2 py-1.5">
      <div className="flex gap-1">
        {(["inherit", "off", "on"] as const).map((mode) => (
          <Button
            key={mode}
            type="button"
            size="xs"
            variant={current.mode === mode ? "secondary" : "ghost"}
            className={cn("flex-1 capitalize", current.mode === mode && "font-medium")}
            onClick={() =>
              persist(
                mode === "on"
                  ? { mode: "on", child: current.mode === "on" ? current.child : undefined }
                  : { mode },
              )
            }
          >
            {mode === "inherit" ? "Inherit" : mode === "off" ? "Off" : "On"}
          </Button>
        ))}
      </div>
      {current.mode === "on" && current.child != null ? (
        <Button type="button" size="xs" variant="ghost" onClick={() => pinChild(null)}>
          Clear pinned child
        </Button>
      ) : null}
      {resolved !== null ? (
        <p className="text-muted-foreground text-xs">
          {resolved.enabled
            ? `Children use ${resolved.child?.model ?? "the cheaper sibling"}. ${subagentPolicyBindCaption(resolved.bind)}`
            : "No new subagents. Running children stay up until you stop them."}
        </p>
      ) : null}
      <Button
        type="button"
        size="xs"
        variant="outline"
        onClick={() => {
          router.history.push("/settings/agents");
        }}
      >
        Open Agents settings
      </Button>
    </div>
  );
}

export function formatSubagentPolicyControlLabel(policy: ThreadSubagentPolicy | undefined): string {
  return policyLabel(threadSubagentPolicyOrInherit(policy ?? DEFAULT_THREAD_SUBAGENT_POLICY));
}
