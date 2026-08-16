/**
 * Settings › Skills — the server-managed skill registry: installed skills with
 * a global on/off per skill, marketplace listings browsed from configured
 * GitHub repository sources, host-folder skills the provider CLIs installed
 * themselves (enable/disable without deleting, or uninstall), and a read-only
 * view of plugin/project/system skills those CLIs still report. Install,
 * uninstall, host enablement, and marketplace refresh go through the
 * skills RPC commands; T3-store enablement and sources are patched into
 * server settings.
 */
import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  HostSkill,
  HostSkillsState,
  InstalledSkill,
  MarketplaceSkill,
  SkillId,
  SkillMarketplaceListing,
  SkillsState,
} from "@t3tools/contracts";
import {
  LaptopIcon,
  LoaderCircleIcon,
  PackageIcon,
  PlusIcon,
  RefreshCwIcon,
  StoreIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useOptimisticIdList } from "~/hooks/useOptimisticIdList";
import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery, type EnvironmentQueryView } from "~/state/query";
import { primaryServerProvidersAtom, serverEnvironment } from "~/state/server";
import { skillsEnvironment } from "~/state/skills";
import { useAtomCommand } from "~/state/use-atom-command";
import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  formatProviderSkillDisplayName,
  formatProviderSkillInstallSource,
  normalizeProviderSkillPath,
} from "../../providerSkillPresentation";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { Switch } from "../ui/switch";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  displaySkillRows,
  finishTombstoneExit,
  nextSkillOrderIds,
  pruneHiddenSkillIds,
  retainedSkillIds,
  SKILL_ROW_EXIT_MS,
  type Identified,
} from "./SkillsSettings.logic";
import "./skillsSettings.css";

const SKILL_REPO_PATTERN = /^[^\s/]+\/[^\s/]+$/;

const EMPTY_INSTALLED_SKILLS: ReadonlyArray<InstalledSkill> = [];
const EMPTY_ID_SET: ReadonlySet<string> = new Set();

function withoutId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  next.delete(id);
  return next;
}
const EMPTY_HOST_SKILLS: ReadonlyArray<HostSkill> = [];

export function SkillsSettingsPanel() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const skillsState = useEnvironmentQuery(
    primaryEnvironmentId === null ? null : skillsEnvironment.skillsStateAtom(primaryEnvironmentId),
  );
  const marketplaceListings = useEnvironmentQuery(
    primaryEnvironmentId === null
      ? null
      : skillsEnvironment.skillMarketplaceListingsAtom(primaryEnvironmentId),
  );
  const hostSkillsState = useEnvironmentQuery(
    primaryEnvironmentId === null
      ? null
      : skillsEnvironment.hostSkillsStateAtom(primaryEnvironmentId),
  );

  return (
    <SettingsPageContainer>
      <InstalledSkillsSection environmentId={primaryEnvironmentId} query={skillsState} />
      <HostSkillsSection environmentId={primaryEnvironmentId} query={hostSkillsState} />
      <MarketplaceSkillsSection environmentId={primaryEnvironmentId} query={marketplaceListings} />
      <DetectedSkillsSection hostSkills={hostSkillsState.data?.skills ?? []} />
    </SettingsPageContainer>
  );
}

function SkillListHint({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      className={cn(
        "px-3 py-2 text-[13px] sm:px-4",
        tone === "error" ? "text-destructive-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

const SKELETON_ROW_KEYS = ["one", "two", "three"] as const;

function SkillListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-1 px-3 sm:px-4">
      {SKELETON_ROW_KEYS.slice(0, rows).map((key) => (
        <Skeleton key={key} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

function useTombstonedSkillList<T extends Identified>(items: ReadonlyArray<T>) {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set());
  const [exiting, setExiting] = useState<ReadonlyMap<string, T>>(() => new Map());
  const orderIdsRef = useRef<ReadonlyArray<string>>([]);
  const liveIds = useMemo(() => new Set(items.map((item) => item.id)), [items]);

  useEffect(() => {
    setHiddenIds((current) => pruneHiddenSkillIds(current, liveIds));
  }, [liveIds]);

  const retainedIds = useMemo(() => retainedSkillIds(items, exiting), [exiting, items]);
  const serverIds = useMemo(() => items.map((item) => item.id), [items]);
  const orderIds = nextSkillOrderIds(orderIdsRef.current, serverIds, retainedIds);
  orderIdsRef.current = orderIds;
  const rows = useMemo(
    () => displaySkillRows(items, hiddenIds, exiting, orderIds),
    [exiting, hiddenIds, items, orderIds],
  );

  const beginExit = useCallback((skill: T) => {
    setHiddenIds((current) => {
      const next = new Set(current);
      next.add(skill.id);
      return next;
    });
    setExiting((current) => {
      const next = new Map(current);
      next.set(skill.id, skill);
      return next;
    });
  }, []);

  const finishExit = useCallback((skillId: string) => {
    setExiting((current) => finishTombstoneExit(current, skillId));
  }, []);

  return { rows, beginExit, finishExit };
}

function SkillRowShell({
  exiting,
  pending,
  skillId,
  onExited,
  children,
}: {
  exiting: boolean;
  pending: boolean;
  skillId: string;
  onExited: (skillId: string) => void;
  children: ReactNode;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const exitedRef = useRef(false);

  useEffect(() => {
    exitedRef.current = false;
  }, [skillId]);

  useEffect(() => {
    if (!exiting || exitedRef.current) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const finish = () => {
      if (exitedRef.current) return;
      exitedRef.current = true;
      onExited(skillId);
    };
    if (reduceMotion) {
      finish();
      return;
    }
    const node = shellRef.current;
    const timeout = window.setTimeout(finish, SKILL_ROW_EXIT_MS + 40);
    const onEnd = (event: TransitionEvent) => {
      if (event.target !== node) return;
      if (event.propertyName !== "opacity" && event.propertyName !== "grid-template-rows") {
        return;
      }
      window.clearTimeout(timeout);
      finish();
    };
    node?.addEventListener("transitionend", onEnd);
    return () => {
      window.clearTimeout(timeout);
      node?.removeEventListener("transitionend", onEnd);
    };
  }, [exiting, onExited, skillId]);

  return (
    <div
      ref={shellRef}
      className="t3-skill-row-shell"
      data-exiting={exiting ? "true" : undefined}
      data-pending={pending ? "true" : undefined}
    >
      <div className="t3-skill-row-shell-inner">{children}</div>
    </div>
  );
}

function InstalledSkillsSection({
  environmentId,
  query,
}: {
  environmentId: EnvironmentId | null;
  query: EnvironmentQueryView<SkillsState>;
}) {
  const settings = usePrimarySettings();
  const persistSettings = useAtomCommand(
    serverEnvironment.updateSettings,
    "server settings update",
  );
  const uninstallSkill = useAtomCommand(skillsEnvironment.uninstallSkill, {
    reportFailure: false,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [uninstallingIds, setUninstallingIds] = useState<ReadonlySet<string>>(EMPTY_ID_SET);
  const installedSkills = query.data?.installedSkills ?? EMPTY_INSTALLED_SKILLS;
  const { rows, beginExit, finishExit } = useTombstonedSkillList(installedSkills);

  // The enabled list is replaced wholesale on every write, so edits chain off
  // the last list sent, not the server value that lags a round trip behind.
  const {
    ids: enabledSkillIds,
    setIds: setEnabledSkillIds,
    reset: resetEnabledSkillIds,
  } = useOptimisticIdList(settings.skills.enabledSkillIds, environmentId ?? "");
  const writeEnabledSkillIds = useCallback(
    (next: ReadonlyArray<SkillId>) => {
      if (environmentId === null) return;
      setEnabledSkillIds(next);
      void persistSettings({
        environmentId,
        input: { patch: { skills: { enabledSkillIds: next } } },
      }).then((result) => {
        if (result._tag === "Failure") {
          resetEnabledSkillIds();
        }
      });
    },
    [environmentId, persistSettings, resetEnabledSkillIds, setEnabledSkillIds],
  );
  const setSkillEnabled = useCallback(
    (skillId: SkillId, enabled: boolean) => {
      const next = enabled
        ? enabledSkillIds.includes(skillId)
          ? enabledSkillIds
          : [...enabledSkillIds, skillId]
        : enabledSkillIds.filter((id) => id !== skillId);
      writeEnabledSkillIds(next);
    },
    [enabledSkillIds, writeEnabledSkillIds],
  );

  const handleUninstall = useCallback(
    async (skill: InstalledSkill) => {
      if (environmentId === null) return;
      const confirmed = await ensureLocalApi().dialogs.confirm(
        [
          `Uninstall "${skill.name}"?`,
          "It is removed from this server's skill store and no longer lands in new threads.",
        ].join("\n"),
        { variant: "destructive" },
      );
      if (!confirmed) return;
      setActionError(null);
      setUninstallingIds((ids) => new Set(ids).add(skill.id));
      const result = await uninstallSkill({ environmentId, input: { skillId: skill.id } });
      setUninstallingIds((ids) => withoutId(ids, skill.id));
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setActionError(error instanceof Error ? error.message : "Could not uninstall the skill.");
        }
        return;
      }
      beginExit(skill);
      // Drop the orphaned enablement so the id does not linger in settings.
      if (enabledSkillIds.includes(skill.id)) {
        writeEnabledSkillIds(enabledSkillIds.filter((id) => id !== skill.id));
      }
    },
    [beginExit, enabledSkillIds, environmentId, uninstallSkill, writeEnabledSkillIds],
  );

  return (
    <SettingsSection
      {...searchableSetting("skills-installed")}
      title="Installed skills"
      icon={<PackageIcon className="size-4.5 text-muted-foreground" />}
    >
      <p className="px-3 pb-2 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
        Skill bundles in this server&rsquo;s store. Enabled skills land in every new thread;
        per-thread picks add on top.
      </p>
      {environmentId === null ? (
        <SkillListHint>Connect an environment to manage skills.</SkillListHint>
      ) : query.error !== null ? (
        <SkillListHint tone="error">{query.error}</SkillListHint>
      ) : query.data === null ? (
        <SkillListSkeleton rows={3} />
      ) : rows.length === 0 ? (
        <SkillListHint>No skills installed yet — find some in the marketplace below.</SkillListHint>
      ) : (
        rows.map(({ skill, exiting }) => (
          <SkillRowShell
            key={skill.id}
            skillId={skill.id}
            exiting={exiting}
            pending={uninstallingIds.has(skill.id)}
            onExited={finishExit}
          >
            <InstalledSkillRow
              skill={skill}
              enabled={enabledSkillIds.includes(skill.id)}
              pending={uninstallingIds.has(skill.id)}
              onToggle={(enabled) => setSkillEnabled(skill.id, enabled)}
              onUninstall={() => void handleUninstall(skill)}
            />
          </SkillRowShell>
        ))
      )}
      {actionError !== null ? <SkillListHint tone="error">{actionError}</SkillListHint> : null}
    </SettingsSection>
  );
}

function InstalledSkillRow({
  skill,
  enabled,
  pending,
  onToggle,
  onUninstall,
}: {
  skill: InstalledSkill;
  enabled: boolean;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
  onUninstall: () => void;
}) {
  return (
    <div className="t3-skill-row group flex w-full items-center gap-3 rounded-xl px-3 py-3 sm:px-4 hover:bg-accent/50">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/60 text-foreground transition-transform duration-150 group-hover:scale-105">
        <PackageIcon className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium tracking-[-0.005em] text-foreground">
            {skill.name}
          </span>
          <Badge variant="outline" size="sm" className="text-muted-foreground">
            {skill.sourceRepo}
          </Badge>
        </div>
        <p className="truncate text-[13px] leading-[1.45] text-muted-foreground/80">
          {skill.description ?? "No description."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          checked={enabled}
          onCheckedChange={(checked) => onToggle(Boolean(checked))}
          disabled={pending}
          aria-label={`Enable ${skill.name} for every thread`}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={pending ? `Uninstalling ${skill.name}` : `Uninstall ${skill.name}`}
          disabled={pending}
          onClick={onUninstall}
          className="text-muted-foreground hover:text-destructive-foreground"
        >
          {pending ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <Trash2Icon className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function MarketplaceSkillsSection({
  environmentId,
  query,
}: {
  environmentId: EnvironmentId | null;
  query: EnvironmentQueryView<ReadonlyArray<SkillMarketplaceListing>>;
}) {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const installSkill = useAtomCommand(skillsEnvironment.installSkill, { reportFailure: false });
  const refreshMarketplace = useAtomCommand(skillsEnvironment.refreshSkillMarketplace, {
    reportFailure: false,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [newRepo, setNewRepo] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [installingIds, setInstallingIds] = useState<ReadonlySet<string>>(EMPTY_ID_SET);
  const [refreshingRepos, setRefreshingRepos] = useState<ReadonlySet<string>>(EMPTY_ID_SET);

  const sources = settings.skills.marketplaceSources;
  const listings = query.data;
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const matchesQuery = useCallback(
    (skill: MarketplaceSkill) =>
      normalizedQuery.length === 0 ||
      skill.name.toLowerCase().includes(normalizedQuery) ||
      (skill.description?.toLowerCase().includes(normalizedQuery) ?? false),
    [normalizedQuery],
  );

  const handleInstall = useCallback(
    async (skill: MarketplaceSkill) => {
      if (environmentId === null) return;
      setActionError(null);
      setInstallingIds((ids) => new Set(ids).add(skill.id));
      const result = await installSkill({ environmentId, input: { skillId: skill.id } });
      setInstallingIds((ids) => withoutId(ids, skill.id));
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setActionError(error instanceof Error ? error.message : "Could not install the skill.");
      }
    },
    [environmentId, installSkill],
  );

  const handleRefresh = useCallback(
    async (repo: string) => {
      if (environmentId === null) return;
      setActionError(null);
      setRefreshingRepos((repos) => new Set(repos).add(repo));
      const result = await refreshMarketplace({ environmentId, input: { repo } });
      setRefreshingRepos((repos) => withoutId(repos, repo));
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        setActionError(
          error instanceof Error ? error.message : "Could not refresh the marketplace.",
        );
      }
    },
    [environmentId, refreshMarketplace],
  );

  const handleAddSource = useCallback(() => {
    const repo = newRepo.trim();
    if (!SKILL_REPO_PATTERN.test(repo)) {
      setAddError("Use the owner/repo format.");
      return;
    }
    if (sources.some((source) => source.repo === repo)) {
      setAddError("That repository is already configured.");
      return;
    }
    setAddError(null);
    setNewRepo("");
    updateSettings({ skills: { marketplaceSources: [...sources, { repo }] } });
    if (environmentId !== null) {
      void refreshMarketplace({ environmentId, input: { repo } });
    }
  }, [environmentId, newRepo, refreshMarketplace, sources, updateSettings]);

  const handleRemoveSource = useCallback(
    (repo: string) => {
      updateSettings({
        skills: { marketplaceSources: sources.filter((source) => source.repo !== repo) },
      });
    },
    [sources, updateSettings],
  );

  return (
    <SettingsSection
      {...searchableSetting("skills-marketplace")}
      title="Marketplace"
      icon={<StoreIcon className="size-4.5 text-muted-foreground" />}
    >
      <p className="px-3 pb-2 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
        Browse skills from GitHub repositories and install them into this server&rsquo;s store.
      </p>
      {environmentId === null ? (
        <SkillListHint>Connect an environment to browse the marketplace.</SkillListHint>
      ) : (
        <>
          <div className="px-3 pb-2 sm:px-4">
            <Input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.currentTarget.value)}
              placeholder="Search marketplace skills…"
              aria-label="Search marketplace skills"
            />
          </div>
          {query.error !== null ? <SkillListHint tone="error">{query.error}</SkillListHint> : null}
          {listings === null && query.error === null ? (
            <SkillListSkeleton rows={3} />
          ) : sources.length === 0 ? (
            <SkillListHint>No repositories configured — add one below.</SkillListHint>
          ) : (
            // Every configured source keeps its row (and its Remove button)
            // even when the listing failed: a mistyped repo must stay removable.
            sources.map((source) => {
              const listing = listings?.find((entry) => entry.repo === source.repo);
              const visibleSkills = (listing?.skills ?? []).filter(matchesQuery);
              return (
                <div key={source.repo} className="space-y-1 pt-1">
                  <div className="flex items-center gap-2 px-3 py-1 sm:px-4">
                    <code className="truncate font-mono text-xs text-muted-foreground">
                      {source.repo}
                    </code>
                    <div className="ms-auto flex shrink-0 items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Refresh ${source.repo}`}
                        disabled={refreshingRepos.has(source.repo)}
                        onClick={() => void handleRefresh(source.repo)}
                      >
                        <RefreshCwIcon
                          className={cn(
                            "size-3.5",
                            refreshingRepos.has(source.repo) && "animate-spin",
                          )}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${source.repo}`}
                        onClick={() => handleRemoveSource(source.repo)}
                      >
                        <XIcon className="size-3.5" />
                      </Button>
                    </div>
                  </div>
                  {listing === undefined ? (
                    <SkillListHint>Not fetched yet — hit refresh.</SkillListHint>
                  ) : visibleSkills.length === 0 ? (
                    <SkillListHint>
                      {normalizedQuery.length > 0
                        ? "No skills match."
                        : "No skills in this repository."}
                    </SkillListHint>
                  ) : (
                    visibleSkills.map((skill) => (
                      <MarketplaceSkillRow
                        key={skill.id}
                        skill={skill}
                        installing={installingIds.has(skill.id)}
                        onInstall={() => void handleInstall(skill)}
                      />
                    ))
                  )}
                </div>
              );
            })
          )}
          {actionError !== null ? <SkillListHint tone="error">{actionError}</SkillListHint> : null}
          <div className="space-y-1 px-3 pt-2 sm:px-4">
            <div className="flex items-center gap-2">
              <Input
                value={newRepo}
                onChange={(event) => {
                  setNewRepo(event.currentTarget.value);
                  setAddError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    handleAddSource();
                  }
                }}
                placeholder="owner/repo"
                aria-label="Add a marketplace repository"
                className="max-w-64"
              />
              <Button
                variant="outline"
                size="sm"
                disabled={newRepo.trim().length === 0}
                onClick={handleAddSource}
              >
                <PlusIcon />
                Add repository
              </Button>
            </div>
            {addError !== null ? (
              <p className="text-xs text-destructive-foreground">{addError}</p>
            ) : null}
          </div>
        </>
      )}
    </SettingsSection>
  );
}

function MarketplaceSkillRow({
  skill,
  installing,
  onInstall,
}: {
  skill: MarketplaceSkill;
  installing: boolean;
  onInstall: () => void;
}) {
  return (
    <div className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 sm:px-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium tracking-[-0.005em] text-foreground">
            {skill.name}
          </span>
        </div>
        <p className="truncate text-[13px] leading-[1.45] text-muted-foreground/80">
          {skill.description ?? "No description."}
        </p>
      </div>
      <div className="flex shrink-0 items-center">
        {skill.installed ? (
          <Badge variant="outline" size="sm" className="text-muted-foreground">
            Installed
          </Badge>
        ) : (
          <Button variant="outline" size="xs" disabled={installing} onClick={onInstall}>
            {installing ? "Installing…" : "Install"}
          </Button>
        )}
      </div>
    </div>
  );
}

function HostSkillsSection({
  environmentId,
  query,
}: {
  environmentId: EnvironmentId | null;
  query: EnvironmentQueryView<HostSkillsState>;
}) {
  const uninstallHostSkill = useAtomCommand(skillsEnvironment.uninstallHostSkill, {
    reportFailure: false,
  });
  const setHostSkillEnabled = useAtomCommand(skillsEnvironment.setHostSkillEnabled, {
    reportFailure: false,
  });
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(EMPTY_ID_SET);

  const skills = query.data?.skills ?? EMPTY_HOST_SKILLS;
  const { rows, beginExit, finishExit } = useTombstonedSkillList(skills);
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleRows = useMemo(
    () =>
      rows.filter(({ skill, exiting }) => {
        if (exiting || normalizedQuery.length === 0) return true;
        return (
          skill.name.toLowerCase().includes(normalizedQuery) ||
          skill.origin.toLowerCase().includes(normalizedQuery) ||
          skill.displayPath.toLowerCase().includes(normalizedQuery) ||
          (skill.description?.toLowerCase().includes(normalizedQuery) ?? false)
        );
      }),
    [normalizedQuery, rows],
  );
  const groups = useMemo(() => {
    const byOrigin = new Map<string, Array<(typeof visibleRows)[number]>>();
    for (const row of visibleRows) {
      const group = byOrigin.get(row.skill.origin);
      if (group === undefined) {
        byOrigin.set(row.skill.origin, [row]);
      } else {
        group.push(row);
      }
    }
    return [...byOrigin.entries()];
  }, [visibleRows]);

  const handleUninstall = useCallback(
    async (skill: HostSkill) => {
      if (environmentId === null) return;
      const confirmed = await ensureLocalApi().dialogs.confirm(
        [
          `Remove "${skill.name}" from ${skill.displayPath}?`,
          "This deletes that folder on this environment. The provider CLI that installed it will stop seeing the skill.",
        ].join("\n"),
        { variant: "destructive" },
      );
      if (!confirmed) return;
      setActionError(null);
      setPendingIds((ids) => new Set(ids).add(skill.id));
      const result = await uninstallHostSkill({
        environmentId,
        input: { skillId: skill.id },
      });
      setPendingIds((ids) => withoutId(ids, skill.id));
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setActionError(error instanceof Error ? error.message : "Could not remove the skill.");
        }
        return;
      }
      beginExit(skill);
      void refreshProviders({ environmentId, input: {} });
    },
    [beginExit, environmentId, refreshProviders, uninstallHostSkill],
  );

  const handleToggle = useCallback(
    async (skill: HostSkill, enabled: boolean) => {
      if (environmentId === null || skill.enabled === enabled) return;
      setActionError(null);
      setPendingIds((ids) => new Set(ids).add(skill.id));
      const result = await setHostSkillEnabled({
        environmentId,
        input: { skillId: skill.id, enabled },
      });
      setPendingIds((ids) => withoutId(ids, skill.id));
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setActionError(error instanceof Error ? error.message : "Could not update the skill.");
        }
        return;
      }
      void refreshProviders({ environmentId, input: {} });
    },
    [environmentId, refreshProviders, setHostSkillEnabled],
  );

  return (
    <SettingsSection
      {...searchableSetting("skills-on-environment")}
      title="On this environment"
      icon={<LaptopIcon className="size-4.5 text-muted-foreground" />}
      headerAction={
        environmentId === null ? null : (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh provider skills"
            disabled={query.isPending}
            onClick={() => query.refresh()}
          >
            <RefreshCwIcon className={cn("size-3.5", query.isPending && "animate-spin")} />
          </Button>
        )
      }
    >
      <p className="px-3 pb-2 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
        Skills Claude, Codex, Cursor, and other provider CLIs installed in their home folders on
        this environment — including over a remote connection. Turn a skill off to hide it from
        those CLIs without deleting it. Removing one deletes that folder.
      </p>
      {environmentId === null ? (
        <SkillListHint>Connect an environment to manage provider skills.</SkillListHint>
      ) : query.error !== null ? (
        <SkillListHint tone="error">{query.error}</SkillListHint>
      ) : query.data === null ? (
        <SkillListSkeleton rows={3} />
      ) : (
        <>
          {rows.length > 0 || skills.length > 0 ? (
            <div className="px-3 pb-2 sm:px-4">
              <Input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                placeholder="Search provider skills…"
                aria-label="Search provider skills"
              />
            </div>
          ) : null}
          {rows.length === 0 ? (
            <SkillListHint>
              No provider CLI skills in their home folders. Marketplace installs land in T3&rsquo;s
              library above.
            </SkillListHint>
          ) : visibleRows.length === 0 ? (
            <SkillListHint>No skills match.</SkillListHint>
          ) : (
            groups.map(([origin, originRows]) => (
              <div key={origin} className="space-y-1 pt-1">
                <div className="px-3 py-1 sm:px-4">
                  <span className="truncate text-xs text-muted-foreground">{origin}</span>
                </div>
                {originRows.map(({ skill, exiting }) => (
                  <SkillRowShell
                    key={skill.id}
                    skillId={skill.id}
                    exiting={exiting}
                    pending={pendingIds.has(skill.id)}
                    onExited={finishExit}
                  >
                    <HostSkillRow
                      skill={skill}
                      pending={pendingIds.has(skill.id)}
                      onToggle={(enabled) => void handleToggle(skill, enabled)}
                      onUninstall={() => void handleUninstall(skill)}
                    />
                  </SkillRowShell>
                ))}
              </div>
            ))
          )}
        </>
      )}
      {actionError !== null ? <SkillListHint tone="error">{actionError}</SkillListHint> : null}
    </SettingsSection>
  );
}

function HostSkillRow({
  skill,
  pending,
  onToggle,
  onUninstall,
}: {
  skill: HostSkill;
  pending: boolean;
  onToggle: (enabled: boolean) => void;
  onUninstall: () => void;
}) {
  return (
    <div className="t3-skill-row group flex w-full items-center gap-3 rounded-xl px-3 py-3 sm:px-4 hover:bg-accent/50">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/60 text-foreground transition-transform duration-150 group-hover:scale-105">
        <PackageIcon className="size-4.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <span className="truncate text-sm font-medium tracking-[-0.005em] text-foreground">
          {skill.name}
        </span>
        <p className="truncate text-[13px] leading-[1.45] text-muted-foreground/80">
          {skill.description ?? "No description."}
        </p>
        <p className="truncate font-mono text-[11px] text-muted-foreground/60">
          {skill.displayPath}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Switch
          checked={skill.enabled}
          disabled={pending}
          onCheckedChange={(checked) => onToggle(Boolean(checked))}
          aria-label={`Enable ${skill.name} for its provider`}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={pending ? `Removing ${skill.name}` : `Remove ${skill.name}`}
          disabled={pending}
          onClick={onUninstall}
          className="text-muted-foreground hover:text-destructive-foreground"
        >
          {pending ? (
            <LoaderCircleIcon className="size-4 animate-spin" />
          ) : (
            <Trash2Icon className="size-4" />
          )}
        </Button>
      </div>
    </div>
  );
}

function DetectedSkillsSection({ hostSkills }: { hostSkills: ReadonlyArray<HostSkill> }) {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const hostSkillPaths = useMemo(() => {
    const paths = new Set<string>();
    for (const skill of hostSkills) {
      const normalized = normalizeProviderSkillPath(skill.path);
      paths.add(normalized);
      if (normalized.endsWith(".t3-disabled")) {
        paths.add(normalized.slice(0, -".t3-disabled".length));
      }
    }
    return paths;
  }, [hostSkills]);
  const detected = useMemo(
    () =>
      deriveProviderInstanceEntries(providers).flatMap((entry) =>
        entry.snapshot.skills
          .filter((skill) => !hostSkillPaths.has(normalizeProviderSkillPath(skill.path)))
          .map((skill) => ({ entry, skill })),
      ),
    [hostSkillPaths, providers],
  );

  if (detected.length === 0) return null;

  return (
    <SettingsSection
      title="Also detected"
      icon={<LaptopIcon className="size-4.5 text-muted-foreground" />}
    >
      <p className="px-3 pb-2 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
        Plugin, system, or project skills the provider CLIs reported. Those stay with the plugin or
        repo — T3 Code does not delete them.
      </p>
      {detected.map(({ entry, skill }) => {
        const source = formatProviderSkillInstallSource(skill);
        return (
          <div
            key={`${entry.instanceId}:${skill.path}`}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 sm:px-4"
          >
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-muted-foreground">
                  {formatProviderSkillDisplayName(skill)}
                </span>
                <Badge variant="outline" size="sm" className="text-muted-foreground">
                  {entry.displayName}
                </Badge>
                {(source ?? skill.scope) ? (
                  <Badge variant="outline" size="sm" className="text-muted-foreground">
                    {source ?? skill.scope}
                  </Badge>
                ) : null}
              </div>
              <p className="truncate font-mono text-[11px] text-muted-foreground/60">
                {skill.path}
              </p>
            </div>
          </div>
        );
      })}
    </SettingsSection>
  );
}
