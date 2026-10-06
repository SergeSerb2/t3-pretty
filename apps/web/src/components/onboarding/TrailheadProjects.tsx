import type {
  AgentSessionProjectCandidate,
  EnvironmentId,
  ProjectId,
  ScopedProjectRef,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import { CommandId, ProviderDriverKind } from "@t3tools/contracts";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { cn, newProjectId } from "../../lib/utils";
import {
  groupOnboardingProjects,
  onboardingProjectKey,
  partitionOnboardingProjects,
  resolveOnboardingLandingProject,
  resolveOnboardingProjectId,
  type OnboardingProjectGroup,
} from "../../onboarding/projectImport.logic";
import { resolveTrailheadImportWarning } from "../../onboarding/trailhead.logic";
import type { useProjectScans } from "../../onboarding/useProjectScans";
import { agentSessionImport } from "../../state/agentSessions";
import { readProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { formatRelativeTime } from "../../timestampFormat";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Spinner } from "../ui/spinner";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { TrailheadCardBody, TrailheadCardFooter, TrailheadHeading } from "./TrailheadParts";

const SCAN_LIMIT_MESSAGE = "Scan limit reached. Some projects or conversations may be missing.";

/** What the climb carried to the Summit. */
export interface TrailheadHaul {
  /** Where the first thread opens; absent when nothing landed. */
  readonly projectRef?: ScopedProjectRef;
  readonly importedProjectCount: number;
  readonly importedThreadCount: number;
  readonly warning: string | null;
}

export const EMPTY_TRAILHEAD_HAUL: TrailheadHaul = {
  importedProjectCount: 0,
  importedThreadCount: 0,
  warning: null,
};

/**
 * Waypoint 3. The Base camp scan already ran, so this usually opens with the
 * list ready and recent repositories pre-picked; importing creates each
 * project and pulls its recent Claude Code and Codex conversations.
 */
export function TrailheadProjects({
  scans,
  isImporting,
  setIsImporting,
  onFinish,
}: {
  readonly scans: ReturnType<typeof useProjectScans>;
  readonly isImporting: boolean;
  readonly setIsImporting: (value: boolean) => void;
  readonly onFinish: (haul: TrailheadHaul) => void;
}) {
  const { environments } = useEnvironments();
  const createProject = useAtomCommand(projectEnvironment.create, { reportFailure: false });
  const importThreads = useAtomCommand(agentSessionImport, { reportFailure: false });
  const [selectedPaths, setSelectedPaths] = useState<ReadonlySet<string> | null>(null);
  // Keep project creation attempts separate from completed history imports so both can retry.
  const importedProjectsRef = useRef(new Map<string, ScopedProjectRef>());
  const projectsWithImportedHistoryRef = useRef(new Map<string, ScopedProjectRef>());
  const projectAttemptsRef = useRef(
    new Map<string, { readonly projectId: ProjectId; readonly commandId: CommandId }>(),
  );
  const importGenerationRef = useRef(0);

  // Ignore command completions after leaving the import step.
  useEffect(() => {
    importGenerationRef.current += 1;
    return () => {
      importGenerationRef.current += 1;
    };
  }, []);

  const { available: candidates, recent } = useMemo(
    () =>
      partitionOnboardingProjects(
        scans.flatMap((scan) =>
          (scan.data?.candidates ?? []).map((candidate) => ({
            ...candidate,
            environmentId: scan.environmentId,
            key: onboardingProjectKey(scan.environmentId, candidate.path),
          })),
        ),
      ),
    [scans],
  );
  const selectedKeys = useMemo(
    () => selectedPaths ?? new Set(recent.map((candidate) => candidate.key)),
    [selectedPaths, recent],
  );
  const selected = candidates.filter((candidate) => selectedKeys.has(candidate.key));
  const isScanning =
    scans.every((scan) => scan.data === null) && scans.some((scan) => scan.isPending);

  const runImport = async (selection: typeof candidates) => {
    if (isImporting) return;
    if (selection.length === 0) {
      onFinish(EMPTY_TRAILHEAD_HAUL);
      return;
    }
    setIsImporting(true);
    const importGeneration = importGenerationRef.current;
    const importedProjects = importedProjectsRef.current;
    const projectAttempts = projectAttemptsRef.current;
    // Interrupted imports are neither failures nor successes — the command was
    // superseded or the environment dropped — but they still didn't land, so
    // they must not read as "imported everything". Retries skip paths that
    // already landed this session (re-creating them would only trip the
    // duplicate-root invariant and read as a failure).
    let landedCount =
      importedProjects.size > 0
        ? selection.filter((candidate) => importedProjects.has(candidate.key)).length
        : 0;
    let importedThreadCount = 0;
    let skippedThreadCount = 0;
    const refreshEnvironments = new Set<EnvironmentId>();
    for (const candidate of selection) {
      const { environmentId } = candidate;
      if (
        importGeneration !== importGenerationRef.current ||
        importedProjects !== importedProjectsRef.current
      ) {
        return;
      }
      if (importedProjects.has(candidate.key)) continue;
      let projectId = resolveOnboardingProjectId(readProjects(), environmentId, candidate);
      if (projectId === null) {
        let attempt = projectAttempts.get(candidate.key);
        if (attempt === undefined) {
          const nextProjectId = newProjectId();
          attempt = {
            projectId: nextProjectId,
            commandId: CommandId.make(`onboarding:project:create:${nextProjectId}`),
          };
          projectAttempts.set(candidate.key, attempt);
        }
        projectId = attempt.projectId;
        const result = await createProject({
          environmentId,
          input: {
            projectId,
            commandId: attempt.commandId,
            title: candidate.title,
            workspaceRoot: candidate.path,
            createWorkspaceRootIfMissing: false,
            defaultModelSelection: null,
          },
        });
        if (
          importGeneration !== importGenerationRef.current ||
          importedProjects !== importedProjectsRef.current
        ) {
          return;
        }
        if (result._tag !== "Success") {
          if (!isAtomCommandInterrupted(result)) {
            projectAttempts.delete(candidate.key);
            refreshEnvironments.add(environmentId);
          }
          continue;
        }
      }

      const threadImportResult = await importThreads({
        environmentId,
        input: { projectId, expectedWorkspaceRoot: candidate.path },
      });
      if (
        importGeneration !== importGenerationRef.current ||
        importedProjects !== importedProjectsRef.current
      ) {
        return;
      }
      if (threadImportResult._tag === "Success") {
        importedThreadCount += threadImportResult.value.importedCount;
        skippedThreadCount += threadImportResult.value.skippedCount;
        if (threadImportResult.value.importedCount > 0) {
          projectsWithImportedHistoryRef.current.set(
            candidate.key,
            scopeProjectRef(environmentId, projectId),
          );
        }
        if (threadImportResult.value.skippedCount === 0) {
          landedCount += 1;
          importedProjects.set(candidate.key, scopeProjectRef(environmentId, projectId));
        }
      } else if (!isAtomCommandInterrupted(threadImportResult)) {
        projectAttempts.delete(candidate.key);
        refreshEnvironments.add(environmentId);
      }
    }
    for (const scan of scans) {
      if (refreshEnvironments.has(scan.environmentId)) scan.refresh();
    }
    setIsImporting(false);
    const projectRef = resolveOnboardingLandingProject(
      selection.map((candidate) => candidate.key),
      projectsWithImportedHistoryRef.current,
      importedProjects,
    );
    onFinish({
      ...(projectRef === undefined ? {} : { projectRef }),
      importedProjectCount: landedCount,
      importedThreadCount,
      warning: resolveTrailheadImportWarning({
        selectedCount: selection.length,
        landedCount,
        importedThreadCount,
        skippedThreadCount,
      }),
    });
  };

  return (
    <>
      <TrailheadCardBody>
        <TrailheadHeading step="saddle" title="Pack your projects.">
          {isScanning
            ? "Still reading your Claude Code and Codex history…"
            : candidates.length > 0
              ? "Found in your Claude Code and Codex history. Recent repositories are already in the pack."
              : "Nothing in your Claude Code or Codex history to bring along."}
        </TrailheadHeading>
        {isScanning ? (
          <div className="flex items-center gap-2.5 py-8 text-sm text-muted-foreground">
            <Spinner size="md" tone="muted" />
            Looking for projects…
          </div>
        ) : (
          <>
            {candidates.length > 0 ? (
              <div className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span role="status" className="font-mono tabular-nums">
                  {selected.length} / {candidates.length} packed
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={isImporting || selected.length === candidates.length}
                    onClick={() => setSelectedPaths(new Set(candidates.map((item) => item.key)))}
                  >
                    Select all
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    disabled={isImporting || selected.length === 0}
                    onClick={() => setSelectedPaths(new Set())}
                  >
                    Select none
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="mt-2 space-y-5">
              {scans.map((scan) => {
                const scanCandidates = candidates.filter(
                  (candidate) => candidate.environmentId === scan.environmentId,
                );
                const label =
                  environments.find(
                    (environment) => environment.environmentId === scan.environmentId,
                  )?.label ?? "Computer";
                return (
                  <fieldset
                    key={scan.environmentId}
                    className="min-w-0 space-y-0.5"
                    disabled={isImporting}
                  >
                    {scans.length > 1 ? (
                      <legend data-trailhead="ledger-label" className="mb-2">
                        {label}
                      </legend>
                    ) : null}
                    {scan.isPending && scan.data === null ? (
                      <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
                        <Spinner size="md" />
                        Looking for projects…
                      </div>
                    ) : scan.error !== null ? (
                      <div
                        role="alert"
                        className="flex items-center justify-between gap-3 text-sm text-muted-foreground"
                      >
                        <span>Could not check projects. {scan.error}</span>
                        <Button variant="ghost" size="sm" onClick={scan.refresh}>
                          Retry
                        </Button>
                      </div>
                    ) : null}
                    {scan.data?.truncated ? (
                      <p className="text-xs text-muted-foreground" role="status">
                        {SCAN_LIMIT_MESSAGE}
                      </p>
                    ) : null}
                    <ImportCandidateList
                      candidates={scanCandidates}
                      selectedKeys={selectedKeys}
                      onSelectionChange={setSelectedPaths}
                    />
                  </fieldset>
                );
              })}
            </div>
          </>
        )}
      </TrailheadCardBody>
      <TrailheadCardFooter>
        <Button
          variant="ghost-muted"
          disabled={isImporting}
          onClick={() => onFinish(EMPTY_TRAILHEAD_HAUL)}
        >
          Skip import
        </Button>
        <Button
          size="lg"
          autoFocus
          disabled={isImporting || selected.length === 0}
          onClick={() => void runImport(selected)}
        >
          {isImporting
            ? "Importing…"
            : `Import ${selected.length} ${selected.length === 1 ? "project" : "projects"}`}
        </Button>
      </TrailheadCardFooter>
    </>
  );
}

type ImportCandidate = AgentSessionProjectCandidate & {
  readonly environmentId: EnvironmentId;
  readonly key: string;
};

/**
 * Repositories first, newest activity on top. Clones of one repository share
 * a group with a tri-state checkbox. Folders that are not git repositories
 * sit collapsed at the bottom so they stay reachable without adding noise.
 * Source icons appear only on repository rows so the columns stay still.
 */
function ImportCandidateList({
  candidates,
  selectedKeys,
  onSelectionChange,
}: {
  readonly candidates: ReadonlyArray<ImportCandidate>;
  readonly selectedKeys: ReadonlySet<string>;
  readonly onSelectionChange: (next: ReadonlySet<string>) => void;
}) {
  const { repositories, other } = useMemo(() => groupOnboardingProjects(candidates), [candidates]);
  const setKeys = (keys: ReadonlyArray<string>, checked: boolean) => {
    const next = new Set(selectedKeys);
    for (const key of keys) {
      if (checked) next.add(key);
      else next.delete(key);
    }
    onSelectionChange(next);
  };
  const otherSelected = other.filter((candidate) => selectedKeys.has(candidate.key)).length;

  return (
    <>
      {repositories.map((group) => (
        <ImportRepositoryGroup
          key={group.key}
          group={group}
          selectedKeys={selectedKeys}
          onToggle={setKeys}
        />
      ))}
      {other.length > 0 ? (
        <Collapsible>
          <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40">
            <Checkbox
              checked={otherSelected === other.length}
              indeterminate={otherSelected > 0 && otherSelected < other.length}
              onCheckedChange={(checked) =>
                setKeys(
                  other.map((candidate) => candidate.key),
                  checked === true,
                )
              }
            />
            <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-1.5 text-left">
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
              <span className="truncate text-sm text-muted-foreground">Other folders</span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                {other.length} {other.length === 1 ? "folder" : "folders"}
              </span>
            </CollapsibleTrigger>
          </div>
          <CollapsiblePanel>
            {other.map((candidate) => (
              <ImportCandidateRow
                key={candidate.key}
                candidate={candidate}
                label={candidate.path}
                nested
                checked={selectedKeys.has(candidate.key)}
                onCheckedChange={(checked) => setKeys([candidate.key], checked)}
              />
            ))}
          </CollapsiblePanel>
        </Collapsible>
      ) : null}
    </>
  );
}

function ImportRepositoryGroup({
  group,
  selectedKeys,
  onToggle,
}: {
  readonly group: OnboardingProjectGroup<ImportCandidate>;
  readonly selectedKeys: ReadonlySet<string>;
  readonly onToggle: (keys: ReadonlyArray<string>, checked: boolean) => void;
}) {
  const keys = group.candidates.map((candidate) => candidate.key);
  const selectedCount = keys.filter((key) => selectedKeys.has(key)).length;
  const single = group.candidates.length === 1;
  const only = group.candidates[0];
  if (single && only !== undefined) {
    return (
      <ImportCandidateRow
        candidate={only}
        label={group.label}
        {...(group.repository === null ? {} : { secondary: only.path })}
        checked={selectedKeys.has(only.key)}
        onCheckedChange={(checked) => onToggle([only.key], checked)}
      />
    );
  }
  return (
    <Collapsible defaultOpen>
      <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40">
        <Checkbox
          checked={selectedCount === keys.length}
          indeterminate={selectedCount > 0 && selectedCount < keys.length}
          onCheckedChange={(checked) => onToggle(keys, checked === true)}
        />
        <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-1.5 text-left">
          <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-90" />
          <span className="truncate text-sm font-medium">{group.label}</span>
          <ImportRowMeta
            sources={[...new Set(group.candidates.flatMap((c) => c.sources))]}
            threadCount={group.threadCount}
            lastActiveAt={group.lastActiveAt}
          />
        </CollapsibleTrigger>
      </div>
      <CollapsiblePanel>
        {group.candidates.map((candidate) => (
          <ImportCandidateRow
            key={candidate.key}
            candidate={candidate}
            label={candidate.path}
            nested
            checked={selectedKeys.has(candidate.key)}
            onCheckedChange={(checked) => onToggle([candidate.key], checked)}
          />
        ))}
      </CollapsiblePanel>
    </Collapsible>
  );
}

function ImportCandidateRow({
  candidate,
  label,
  secondary,
  nested = false,
  checked,
  onCheckedChange,
}: {
  readonly candidate: ImportCandidate;
  readonly label: string;
  readonly secondary?: string;
  readonly nested?: boolean;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/40 has-disabled:cursor-default",
        nested && "pl-8",
      )}
    >
      <Checkbox checked={checked} onCheckedChange={(value) => onCheckedChange(value === true)} />
      <Tooltip>
        <TooltipTrigger
          render={<span className="flex min-w-0 flex-1 items-baseline gap-2 truncate" />}
        >
          <span className={cn("truncate", nested ? "font-mono text-xs" : "text-sm font-medium")}>
            {label}
          </span>
          {secondary !== undefined ? (
            <span className="truncate font-mono text-2xs text-muted-foreground">{secondary}</span>
          ) : null}
        </TooltipTrigger>
        <TooltipPopup variant="code">{candidate.path}</TooltipPopup>
      </Tooltip>
      <ImportRowMeta
        sources={nested ? null : candidate.sources}
        threadCount={candidate.threadCount}
        lastActiveAt={candidate.lastActiveAt}
      />
    </label>
  );
}

/**
 * Trailing columns shared by every import row: source icons, thread count,
 * last activity. Each column has a fixed width and each icon has its own slot
 * so nothing shifts between rows that differ in sources or digit count.
 */
function ImportRowMeta({
  sources,
  threadCount,
  lastActiveAt,
}: {
  readonly sources: ReadonlyArray<"claudeAgent" | "codex"> | null;
  readonly threadCount: number;
  readonly lastActiveAt: string | null;
}) {
  const relative = lastActiveAt === null ? null : formatRelativeTime(lastActiveAt);
  // "just now" does not fit the fixed column, so collapse it.
  const age = relative === null ? "" : relative.suffix === null ? "now" : relative.value;
  return (
    <span className="ml-auto grid shrink-0 grid-cols-[1rem_1rem_2.5rem_2.25rem] items-center gap-x-1 text-xs text-muted-foreground tabular-nums">
      <span className="flex size-4 items-center justify-center">
        {sources?.includes("claudeAgent") ? (
          <span role="img" aria-label="Claude Code">
            <ProviderInstanceIcon
              driverKind={ProviderDriverKind.make("claudeAgent")}
              displayName="Claude Code"
              iconClassName="size-3"
            />
          </span>
        ) : null}
      </span>
      <span className="flex size-4 items-center justify-center">
        {sources?.includes("codex") ? (
          <span role="img" aria-label="Codex">
            <ProviderInstanceIcon
              driverKind={ProviderDriverKind.make("codex")}
              displayName="Codex"
              iconClassName="size-3"
            />
          </span>
        ) : null}
      </span>
      <span className="text-right">{threadCount}</span>
      <span className="text-right whitespace-nowrap">{age}</span>
    </span>
  );
}
