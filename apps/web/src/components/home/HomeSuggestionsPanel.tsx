import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, HomeSuggestion, ScopedProjectRef } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import { CompassIcon, SettingsIcon, SparklesIcon, XIcon } from "lucide-react";
import { useCallback, useMemo } from "react";

import { cn } from "~/lib/utils";
import { useComposerDraftStore, type DraftId } from "../../composerDraftStore";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useProjects } from "../../state/entities";
import { homeSuggestionsEnvironment } from "../../state/homeSuggestions";
import { environmentServerConfigsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProjectFavicon } from "../ProjectFavicon";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { toastManager } from "../ui/toast";

function describeCommandFailure(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "An error occurred.";
}

/**
 * The day's suggested prompts, shown on the draft landing between the
 * headline and the composer. Picking a card types its prompt into the open
 * draft; a card for another project opens a draft there first. The panel
 * stays quiet (renders nothing) whenever there is nothing worth showing, so
 * the landing never loses its calm to a loading or error state.
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
  const projectsById = useMemo(
    () =>
      new Map<string, EnvironmentProject>(
        projects
          .filter((project) => project.environmentId === environmentId)
          .map((project) => [project.id, project]),
      ),
    [environmentId, projects],
  );

  const start = useCallback(
    async (card: HomeSuggestion) => {
      const sameProject =
        card.projectId === null ||
        (activeProjectRef !== null &&
          activeProjectRef.environmentId === environmentId &&
          activeProjectRef.projectId === card.projectId);
      if (sameProject && draftId !== null) {
        setPrompt(draftId, card.prompt);
        return;
      }
      const target = card.projectId === null ? activeProjectRef : null;
      const projectId = card.projectId ?? target?.projectId ?? null;
      if (projectId === null) return;
      const opened = await handleNewThread(scopeProjectRef(environmentId, projectId));
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
  const cards = snapshot.suggestions;
  if (cards.length === 0 && !generating) return null;

  return (
    <section
      aria-label="Suggested prompts"
      className="pointer-events-auto mx-auto mb-6 flex w-full flex-col gap-2"
    >
      <div className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <SparklesIcon className="size-3.5" />
        <span>{generating ? "Planning today's suggestions…" : "Suggested for today"}</span>
        <div className="ml-auto flex items-center">
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
        </div>
      </div>
      {cards.length > 0 ? (
        <ul className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {cards.map((card) => (
            <li key={card.id} className="w-64 shrink-0 snap-start">
              <SuggestionCard
                card={card}
                project={
                  card.projectId === null ? null : (projectsById.get(card.projectId) ?? null)
                }
                onStart={() => void start(card)}
                onDismiss={() => void onDismiss(card.id)}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function SuggestionCard({
  card,
  project,
  onStart,
  onDismiss,
}: {
  readonly card: HomeSuggestion;
  readonly project: EnvironmentProject | null;
  readonly onStart: () => void;
  readonly onDismiss: () => void;
}) {
  return (
    <div className="group relative h-full">
      <button
        type="button"
        onClick={onStart}
        className="flex h-full w-full flex-col gap-1 rounded-xl border border-border/55 bg-card/40 px-3 py-2.5 text-left transition-colors hover:border-border hover:bg-card/70 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex items-center gap-1.5 pr-5 text-[.6875rem] text-muted-foreground">
          {project ? (
            <>
              <ProjectFavicon project={project} className="size-3.5 shrink-0" />
              <span className="truncate">{project.title}</span>
            </>
          ) : (
            <>
              <CompassIcon className="size-3.5 shrink-0" />
              <span>New idea</span>
            </>
          )}
        </span>
        <span className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
          {card.title}
        </span>
        <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground/78">
          {card.summary}
        </span>
      </button>
      <Button
        size="icon-xs"
        variant="ghost-muted"
        className="absolute top-1.5 right-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        aria-label={`Dismiss ${card.title}`}
        onClick={onDismiss}
      >
        <XIcon className="size-3" />
      </Button>
    </div>
  );
}
