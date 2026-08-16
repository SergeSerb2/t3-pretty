/**
 * Composer `⋯` menu section for per-thread subagent policy.
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
import { MenuSub, MenuSubPopup, MenuSubTrigger } from "../ui/menu";
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

function useCurrentSubagentPolicy(props: SubagentPolicyPickerProps): ThreadSubagentPolicy {
  const draftPolicy = useComposerDraftStore((store) =>
    props.draftId ? store.getComposerDraft(props.draftId)?.subagentPolicy : undefined,
  );
  return threadSubagentPolicyOrInherit(props.draftId ? draftPolicy : props.threadPolicy);
}

/** `Agents ▸` row of the composer's `⋯` menu; the trigger echoes the current policy. */
export function SubagentPolicySubmenu(props: SubagentPolicyPickerProps) {
  const current = useCurrentSubagentPolicy(props);
  return (
    <MenuSub>
      <MenuSubTrigger>
        <BotIcon aria-hidden="true" />
        <span>Agents</span>
        <span className="ms-auto min-w-0 truncate ps-3 text-muted-foreground text-xs">
          {policyLabel(current)}
        </span>
      </MenuSubTrigger>
      <MenuSubPopup className="w-80 max-w-full">
        <SubagentPolicyMenuContent {...props} />
      </MenuSubPopup>
    </MenuSub>
  );
}

function SubagentPolicyMenuContent(props: SubagentPolicyPickerProps) {
  const router = useRouter();
  const settings = usePrimarySettings();
  const serverProviders = useAtomValue(primaryServerProvidersAtom);
  const setDraftPolicy = useComposerDraftStore((store) => store.setSubagentPolicy);
  const setThreadPolicy = useAtomCommand(threadEnvironment.setThreadSubagentPolicy, {
    reportFailure: false,
  });

  const current = useCurrentSubagentPolicy(props);
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
