import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  HomeSuggestion,
  HomeSuggestionKind,
  ScopedProjectRef,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { SettingsIcon, SparklesIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { cn } from "~/lib/utils";
import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjects } from "../../state/entities";
import { homeSuggestionsEnvironment } from "../../state/homeSuggestions";
import { environmentServerConfigsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { toastManager } from "../ui/toast";
import { HomeSuggestionShelfView } from "./HomeSuggestionShelf";
import { groupHomeSuggestionShelves } from "./homeSuggestionShelves";

const projectRefKey = (environmentId: EnvironmentId, projectId: string) =>
  `${environmentId}\u0000${projectId}`;

function describeCommandFailure(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "An error occurred.";
}

/**
 * The day's suggested prompts, shown on the draft landing between the
 * headline and the composer. Project cards and new ideas are two tabs over one
 * horizontal shelf, so the landing stays a single row tall. Picking a card types its prompt into the open draft; a
 * card for another project opens a draft there first, on whichever connected
 * environment owns it (linked machines share one batch). A project card whose
 * environment this client cannot see is hidden. The panel stays quiet
 * (renders nothing) whenever there is nothing worth showing, so the landing
 * never loses its calm to a loading or error state.
 */
export function HomeSuggestionsPanel({
  environmentId,
  draftId,
  activeProjectRef,
}: {
  readonly environmentId: EnvironmentId | null;
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
}) {
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const config = environmentId === null ? undefined : serverConfigs.get(environmentId);
  const supported = config?.environment.capabilities.homeSuggestions === true;
  const enabled = config?.settings.homeSuggestionsEnabled === true;
  return environmentId !== null && supported && enabled ? (
    <EnvironmentSuggestionsStrip
      environmentId={environmentId}
      draftId={draftId}
      activeProjectRef={activeProjectRef}
    />
  ) : null;
}

function EnvironmentSuggestionsStrip({
  environmentId,
  draftId,
  activeProjectRef,
}: {
  readonly environmentId: EnvironmentId;
  readonly draftId: DraftId | null;
  readonly activeProjectRef: ScopedProjectRef | null;
}) {
  const result = useAtomValue(homeSuggestionsEnvironment.snapshot({ environmentId, input: {} }));
  const snapshot = Option.getOrNull(AsyncResult.value(result));
  const refresh = useAtomCommand(homeSuggestionsEnvironment.refresh, { reportFailure: false });
  const dismiss = useAtomCommand(homeSuggestionsEnvironment.dismiss, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const projects = useProjects();
  const [selectedKind, setSelectedKind] = useState<HomeSuggestionKind>("project");
  const projectsByRef = useMemo(
    () =>
      new Map<string, EnvironmentProject>(
        projects.map((project) => [projectRefKey(project.environmentId, project.id), project]),
      ),
    [projects],
  );
  const projectFor = useCallback(
    (card: HomeSuggestion) =>
      card.projectId === null
        ? null
        : (projectsByRef.get(projectRefKey(card.environmentId ?? environmentId, card.projectId)) ??
          null),
    [environmentId, projectsByRef],
  );

  const start = useCallback(
    async (card: HomeSuggestion) => {
      const target =
        card.projectId === null
          ? activeProjectRef
          : scopeProjectRef(card.environmentId ?? environmentId, card.projectId);
      const sameProject =
        card.projectId === null ||
        (activeProjectRef !== null &&
          target !== null &&
          activeProjectRef.environmentId === target.environmentId &&
          activeProjectRef.projectId === target.projectId);
      if (sameProject && draftId !== null) {
        setPrompt(draftId, card.prompt);
        return;
      }
      if (target === null) return;
      const opened = await handleNewThread(target);
      if (opened !== null) setPrompt(opened.draftId, card.prompt);
    },
    [activeProjectRef, draftId, environmentId, handleNewThread, setPrompt],
  );

  const onRefresh = useCallback(async () => {
    const outcome = await refresh({ environmentId, input: {} });
    if (outcome._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Could not refresh suggestions",
        description: describeCommandFailure(outcome),
      });
    }
  }, [environmentId, refresh]);

  const onDismiss = useCallback(
    async (suggestionId: HomeSuggestion["id"]) => {
      const outcome = await dismiss({ environmentId, input: { suggestionId } });
      if (outcome._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: "Could not dismiss suggestion",
          description: describeCommandFailure(outcome),
        });
      }
    },
    [dismiss, environmentId],
  );

  if (snapshot === null) return null;
  const generating = snapshot.status === "generating";
  const cards = snapshot.suggestions.filter(
    (card) => card.projectId === null || projectFor(card) !== null,
  );
  if (cards.length === 0 && !generating) return null;

  const shelves = groupHomeSuggestionShelves(cards);
  const shelf = shelves.find((candidate) => candidate.kind === selectedKind) ?? shelves[0];

  const actions = (
    <>
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label="Refresh suggestions"
        disabled={generating}
        onClick={() => void onRefresh()}
      >
        <RefreshIcon className={cn("size-3.5", generating && "animate-spin")} />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost-muted"
        aria-label="Suggestion settings"
        render={<Link to="/settings/general" />}
      >
        <SettingsIcon className="size-3.5" />
      </Button>
    </>
  );

  return (
    <section
      aria-label="Suggested prompts"
      className="pointer-events-auto mt-8 flex w-full flex-col sm:mt-10"
    >
      {shelf === undefined ? (
        <div className="flex h-7 items-center gap-2 px-0.5 text-xs text-muted-foreground">
          <SparklesIcon className="size-3.5 shrink-0" />
          <span>Planning today's suggestions…</span>
          <div className="ml-auto flex items-center gap-0.5">{actions}</div>
        </div>
      ) : (
        <HomeSuggestionShelfView
          key={shelf.kind}
          shelf={shelf}
          heading={
            <>
              <SparklesIcon className="size-3.5 shrink-0" />
              {shelves.length > 1 ? (
                <div role="group" aria-label="Suggestion kind" className="flex items-center gap-3">
                  {shelves.map((candidate) => (
                    <button
                      key={candidate.kind}
                      type="button"
                      aria-pressed={candidate.kind === shelf.kind}
                      onClick={() => setSelectedKind(candidate.kind)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-sm transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                        candidate.kind === shelf.kind
                          ? "text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {candidate.label}
                      <span className="text-muted-foreground/70 tabular-nums">
                        {candidate.cards.length}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <span>{shelf.label}</span>
              )}
            </>
          }
          actions={actions}
          projectFor={projectFor}
          onStart={(card) => void start(card)}
          onDismiss={(card) => void onDismiss(card.id)}
        />
      )}
    </section>
  );
}
