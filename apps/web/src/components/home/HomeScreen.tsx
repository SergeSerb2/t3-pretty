import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, HomeSuggestion, HomeSuggestionsSnapshot } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { AsyncResult } from "effect/unstable/reactivity";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  CompassIcon,
  FolderCodeIcon,
  PlayIcon,
  SettingsIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useMemo, type ReactNode } from "react";

import { APP_DISPLAY_NAME } from "~/branding";
import { cn } from "~/lib/utils";
import { useComposerDraftStore } from "../../composerDraftStore";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { useProjects, useThreadShells } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { homeSuggestionsEnvironment } from "../../state/homeSuggestions";
import { environmentServerConfigsAtom } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import {
  formatNextRun,
  rememberExploreProjectId,
  resolveExploreProjectId,
} from "./HomeScreen.logic";
import { ProjectFavicon } from "../ProjectFavicon";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { RefreshIcon } from "../ui/refresh-icon";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { Skeleton } from "../ui/skeleton";
import { toastManager } from "../ui/toast";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

const RECENT_THREAD_COUNT = 6;
const HOME_EXPLORE_PROJECT_STORAGE_KEY = "t3code:home-explore-project:v1";
const HomeExploreProjectPreference = Schema.Record(Schema.String, Schema.String);
const EMPTY_EXPLORE_PROJECT_PREFERENCE: Record<string, string> = {};

const CARD_CLASS =
  "group flex min-h-40 flex-col gap-2 rounded-2xl border border-border/55 bg-card/20 p-4 text-left shadow-sm/5 transition-colors hover:border-border hover:bg-card/40";

function describeCommandFailure(result: Parameters<typeof squashAtomCommandFailure>[0]): string {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error ? error.message : "An error occurred.";
}

/**
 * The landing page: a row of the threads touched last, then the day's
 * suggested prompts per environment. Starting a card opens a draft in the
 * card's project with the prompt already typed, so nothing is sent until the
 * user presses send.
 */
export function HomeScreen() {
  const projects = useProjects();
  const threads = useThreadShells();
  const serverConfigs = useAtomValue(environmentServerConfigsAtom);
  const { presentationById } = useEnvironments();

  const recentThreads = useMemo(
    () =>
      [...threads]
        .filter((thread) => thread.archivedAt === null)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
        .slice(0, RECENT_THREAD_COUNT),
    [threads],
  );
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [`${project.environmentId}:${project.id}`, project])),
    [projects],
  );
  const environmentIds = useMemo(
    () =>
      [...serverConfigs.entries()]
        .filter(([, config]) => config.environment.capabilities.homeSuggestions === true)
        .map(([environmentId]) => environmentId),
    [serverConfigs],
  );

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-clip overscroll-y-none bg-background text-foreground">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-clip bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <h1 className="text-sm font-medium text-foreground md:text-muted-foreground/60">
            {APP_DISPLAY_NAME}
          </h1>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <WorkspacePageContainer width="expanded" className="gap-8">
            {recentThreads.length > 0 ? (
              <section className="flex flex-col gap-3">
                <SectionHeading title="Jump back in" />
                <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {recentThreads.map((thread) => (
                    <li key={`${thread.environmentId}:${thread.id}`}>
                      <RecentThreadLink
                        thread={thread}
                        project={
                          projectsById.get(`${thread.environmentId}:${thread.projectId}`) ?? null
                        }
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {environmentIds.map((environmentId) => (
              <EnvironmentSuggestions
                key={environmentId}
                environmentId={environmentId}
                label={
                  environmentIds.length > 1
                    ? (presentationById.get(environmentId)?.entry.target.label ?? null)
                    : null
                }
                enabled={serverConfigs.get(environmentId)?.settings.homeSuggestionsEnabled ?? true}
                projects={projects}
                threads={threads}
              />
            ))}
          </WorkspacePageContainer>
        </div>
      </div>
    </SidebarInset>
  );
}

function SectionHeading({
  title,
  description,
  icon: Icon,
  action,
}: {
  readonly title: string;
  readonly description?: string;
  readonly icon?: typeof SparklesIcon;
  readonly action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="flex items-center gap-1.5 text-base font-medium text-foreground">
          {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
          {title}
        </h2>
        {description ? <p className="text-xs text-muted-foreground/78">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function RecentThreadLink({
  thread,
  project,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly project: EnvironmentProject | null;
}) {
  return (
    <Link
      to="/$environmentId/$threadId"
      params={{ environmentId: thread.environmentId, threadId: thread.id }}
      className="flex items-center gap-3 rounded-xl border border-border/55 bg-card/20 px-3 py-2.5 transition-colors hover:border-border hover:bg-card/40"
    >
      {project ? (
        <ProjectFavicon project={project} className="size-5 shrink-0" />
      ) : (
        <FolderCodeIcon className="size-5 shrink-0 text-muted-foreground" />
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm text-foreground">{thread.title}</span>
        <span className="truncate text-xs text-muted-foreground/78">
          {project?.title ?? "Project"} · {formatRelativeTimeLabel(thread.updatedAt)}
        </span>
      </span>
    </Link>
  );
}

function EnvironmentSuggestions({
  environmentId,
  label,
  enabled,
  projects,
  threads,
}: {
  readonly environmentId: EnvironmentId;
  readonly label: string | null;
  readonly enabled: boolean;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}) {
  const snapshotAtom = homeSuggestionsEnvironment.snapshot({ environmentId, input: {} });
  const result = useAtomValue(snapshotAtom);
  const resubscribe = useAtomRefresh(snapshotAtom);
  const snapshot = Option.getOrNull(AsyncResult.value(result));
  const subscriptionFailed = AsyncResult.isFailure(result) && snapshot === null;
  const refresh = useAtomCommand(homeSuggestionsEnvironment.refresh, { reportFailure: false });
  const dismiss = useAtomCommand(homeSuggestionsEnvironment.dismiss, { reportFailure: false });
  const handleNewThread = useNewThreadHandler();
  const setPrompt = useComposerDraftStore((store) => store.setPrompt);
  const [exploreProjectByEnvironment, setExploreProjectByEnvironment] = useLocalStorage(
    HOME_EXPLORE_PROJECT_STORAGE_KEY,
    EMPTY_EXPLORE_PROJECT_PREFERENCE,
    HomeExploreProjectPreference,
  );

  const environmentProjects = useMemo(
    () =>
      sortScopedProjectsForSidebar(
        projects.filter((project) => project.environmentId === environmentId),
        threads,
        "updated_at",
      ),
    [environmentId, projects, threads],
  );
  const projectsById = useMemo(
    () =>
      new Map<string, EnvironmentProject>(
        environmentProjects.map((project) => [project.id, project]),
      ),
    [environmentProjects],
  );
  // Explore cards belong to no project. Remember the last "Start in"
  // choice per environment; fall back to the project they touched last.
  const exploreProjectId = resolveExploreProjectId(
    exploreProjectByEnvironment[environmentId],
    environmentProjects.map((project) => project.id),
  );
  const exploreProject =
    exploreProjectId === null ? null : (projectsById.get(exploreProjectId) ?? null);

  const start = useCallback(
    async (card: HomeSuggestion) => {
      const project =
        card.projectId === null ? exploreProject : (projectsById.get(card.projectId) ?? null);
      if (project === null) {
        toastManager.add({
          type: "error",
          title: "Pick a project first",
          description: "This suggestion needs a project to start in.",
        });
        return;
      }
      const opened = await handleNewThread(scopeProjectRef(project.environmentId, project.id));
      if (opened !== null) {
        setPrompt(opened.draftId, card.prompt);
      }
    },
    [exploreProject, handleNewThread, projectsById, setPrompt],
  );

  const onRefresh = useCallback(async () => {
    // A dead subscription would never deliver the batch this request starts.
    if (subscriptionFailed) resubscribe();
    const outcome = await refresh({ environmentId, input: {} });
    if (outcome._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Could not refresh suggestions",
        description: describeCommandFailure(outcome),
      });
    }
  }, [environmentId, refresh, resubscribe, subscriptionFailed]);

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

  // Nothing here can be started without a project, and the server has
  // nothing to digest either.
  if (environmentProjects.length === 0) return null;

  const projectCards = snapshot?.suggestions.filter((card) => card.kind === "project") ?? [];
  const exploreCards = snapshot?.suggestions.filter((card) => card.kind === "explore") ?? [];
  const generating = snapshot?.status === "generating";

  return (
    <section className="flex flex-col gap-6">
      <SectionHeading
        title={label ? `Suggestions · ${label}` : "Suggestions"}
        icon={SparklesIcon}
        description={describeSnapshot(snapshot, enabled, subscriptionFailed)}
        action={
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={!enabled || generating || (snapshot === null && !subscriptionFailed)}
              onClick={() => void onRefresh()}
            >
              <RefreshIcon className={cn("size-4", generating && "animate-spin")} />
              {generating ? "Generating" : "Refresh"}
            </Button>
            <Button
              size="sm"
              variant="ghost-muted"
              render={<Link to="/settings/general" />}
              aria-label="Suggestion settings"
            >
              <SettingsIcon className="size-4" />
            </Button>
          </div>
        }
      />
      {subscriptionFailed ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/70 px-6 py-10 text-center text-sm text-muted-foreground/78">
          Suggestions could not be loaded from this environment.
          <Button size="sm" variant="outline" onClick={resubscribe}>
            <RefreshIcon className="size-4" />
            Try again
          </Button>
        </div>
      ) : snapshot === null ? (
        <CardGrid>
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="min-h-40 rounded-2xl" />
          ))}
        </CardGrid>
      ) : snapshot.suggestions.length === 0 ? (
        <EmptySuggestions snapshot={snapshot} enabled={enabled} />
      ) : (
        <>
          {projectCards.length > 0 ? (
            <div className="flex flex-col gap-3">
              <h3 className="text-sm font-medium text-muted-foreground">Keep going</h3>
              <CardGrid>
                {projectCards.map((card) => (
                  <SuggestionCard
                    key={card.id}
                    card={card}
                    project={
                      card.projectId === null ? null : (projectsById.get(card.projectId) ?? null)
                    }
                    onStart={() => void start(card)}
                    onDismiss={() => void onDismiss(card.id)}
                  />
                ))}
              </CardGrid>
            </div>
          ) : null}
          {exploreCards.length > 0 ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
                  <CompassIcon className="size-4" />
                  Something new
                </h3>
                {environmentProjects.length > 1 ? (
                  <Select
                    value={exploreProject?.id ?? null}
                    onValueChange={(value) => {
                      if (value === null) return;
                      setExploreProjectByEnvironment((current) =>
                        rememberExploreProjectId(current, environmentId, value),
                      );
                    }}
                  >
                    <SelectTrigger size="sm" className="w-56" aria-label="Project for new ideas">
                      <span className="text-muted-foreground">Start in</span>
                      <SelectValue>
                        {(value: string | null) =>
                          value === null
                            ? "Pick a project"
                            : (projectsById.get(value)?.title ?? value)
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup align="end" alignItemWithTrigger={false}>
                      {environmentProjects.map((project) => (
                        <SelectItem key={project.id} hideIndicator value={project.id}>
                          {project.title}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                ) : null}
              </div>
              <CardGrid>
                {exploreCards.map((card) => (
                  <SuggestionCard
                    key={card.id}
                    card={card}
                    project={null}
                    onStart={() => void start(card)}
                    onDismiss={() => void onDismiss(card.id)}
                  />
                ))}
              </CardGrid>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}

function describeSnapshot(
  snapshot: HomeSuggestionsSnapshot | null,
  enabled: boolean,
  failed: boolean,
): string {
  if (!enabled) return "Daily suggestions are off. Turn them on in Settings → General.";
  if (failed) return "Unavailable";
  if (snapshot === null) return "Loading…";
  const parts: string[] = [];
  if (snapshot.status === "generating") parts.push("Generating a fresh batch");
  else if (snapshot.generatedAt !== null) {
    parts.push(`Generated ${formatRelativeTimeLabel(snapshot.generatedAt)}`);
  }
  if (snapshot.status === "failed" && snapshot.error !== null) {
    parts.push(`Last attempt failed: ${snapshot.error}`);
  }
  if (snapshot.nextRunAt !== null) {
    parts.push(`next batch ${formatNextRun(snapshot.nextRunAt, snapshot.timeZone)}`);
  }
  return parts.join(" · ");
}

function EmptySuggestions({
  snapshot,
  enabled,
}: {
  readonly snapshot: HomeSuggestionsSnapshot;
  readonly enabled: boolean;
}) {
  const message = !enabled
    ? "Turn suggestions on to get a daily set of prompts based on your projects."
    : snapshot.status === "generating"
      ? "Reading your recent threads and planning the day. This takes a minute."
      : snapshot.status === "failed"
        ? "The last batch could not be generated. Check the suggestion model in Settings, then refresh."
        : "No suggestions yet. Refresh to generate the first batch.";
  return (
    <div className="rounded-2xl border border-dashed border-border/70 px-6 py-10 text-center text-sm text-muted-foreground/78">
      {message}
    </div>
  );
}

function CardGrid({ children }: { readonly children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
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
    <article className={CARD_CLASS}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {project ? (
          <>
            <ProjectFavicon project={project} className="size-4 shrink-0" />
            <span className="truncate">{project.title}</span>
          </>
        ) : (
          <>
            <CompassIcon className="size-4 shrink-0" />
            <span>New idea</span>
          </>
        )}
        <Button
          size="icon-xs"
          variant="ghost-muted"
          className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Dismiss ${card.title}`}
          onClick={onDismiss}
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>
      <h3 className="text-sm font-medium leading-snug text-foreground">{card.title}</h3>
      <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground/78">
        {card.summary}
      </p>
      <div className="mt-auto flex items-center justify-between pt-2">
        <Button size="sm" variant="outline" onClick={onStart}>
          <PlayIcon className="size-3.5" />
          Start
        </Button>
      </div>
    </article>
  );
}
