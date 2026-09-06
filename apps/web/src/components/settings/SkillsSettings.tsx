/**
 * Settings › Skills — the skill folders this environment's host actually has:
 * the shared `~/.agents/skills` library plus each provider CLI's own folder,
 * one row per real folder. A provider chip is on when that CLI can see the
 * skill, and toggling it adds or removes the link in that CLI's folder. Below
 * that, marketplace listings browsed from configured GitHub repositories;
 * installs land in the shared library. Sources are patched into server
 * settings, everything else goes through the skills RPC commands.
 */
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  MarketplaceSkill,
  Skill,
  SkillLocation,
  SkillMarketplaceListing,
  SkillsState,
} from "@t3tools/contracts";
import {
  LoaderCircleIcon,
  PackageIcon,
  PlusIcon,
  RefreshCwIcon,
  StoreIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { usePrimarySettings, useUpdatePrimarySettings } from "~/hooks/useSettings";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery, type EnvironmentQueryView } from "~/state/query";
import { skillsEnvironment } from "~/state/skills";
import { useAtomCommand } from "~/state/use-atom-command";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import {
  displaySkillRows,
  finishTombstoneExit,
  linkOverrideKey,
  nextSkillOrderIds,
  pruneHiddenSkillIds,
  pruneSettledLinkOverrides,
  retainedSkillIds,
  skillChipState,
  SKILL_ROW_EXIT_MS,
  type Identified,
  type SkillChipState,
} from "./SkillsSettings.logic";
import "./skillsSettings.css";

const SKILL_REPO_PATTERN = /^[^\s/]+\/[^\s/]+$/;
/** Above this many rows the list stops being scannable and earns a filter box. */
const SKILL_SEARCH_THRESHOLD = 6;

const EMPTY_SKILLS: ReadonlyArray<Skill> = [];
const EMPTY_LOCATIONS: ReadonlyArray<SkillLocation> = [];
const EMPTY_ID_SET: ReadonlySet<string> = new Set();
const EMPTY_OVERRIDES: ReadonlyMap<string, boolean> = new Map();

function withoutId(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(ids);
  next.delete(id);
  return next;
}

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
  const environmentKey = primaryEnvironmentId ?? "no-environment";

  return (
    <SettingsPageContainer>
      <SkillLibrarySection
        key={`library:${environmentKey}`}
        environmentId={primaryEnvironmentId}
        query={skillsState}
      />
      <MarketplaceSkillsSection
        key={`marketplace:${environmentKey}`}
        environmentId={primaryEnvironmentId}
        query={marketplaceListings}
      />
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

function SkillLibrarySection({
  environmentId,
  query,
}: {
  environmentId: EnvironmentId | null;
  query: EnvironmentQueryView<SkillsState>;
}) {
  const uninstallSkill = useAtomCommand(skillsEnvironment.uninstallSkill, {
    reportFailure: false,
  });
  const setLocationEnabled = useAtomCommand(skillsEnvironment.setSkillLocationEnabled, {
    reportFailure: false,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [uninstallingIds, setUninstallingIds] = useState<ReadonlySet<string>>(EMPTY_ID_SET);
  // skill id → the location key whose chip is mid-flight, so only that chip spins.
  const [pendingChips, setPendingChips] = useState<ReadonlyMap<string, string>>(new Map());
  // Chip states the user picked, held until the refreshed inventory agrees.
  const [linkOverrides, setLinkOverrides] = useState<ReadonlyMap<string, boolean>>(EMPTY_OVERRIDES);

  const skills = query.data?.skills ?? EMPTY_SKILLS;
  const locations = query.data?.locations ?? EMPTY_LOCATIONS;
  // The shared library is not a provider, so it gets no chip of its own.
  const providerLocations = useMemo(
    () => locations.filter((location) => location.driver !== undefined),
    [locations],
  );
  const { rows, beginExit, finishExit } = useTombstonedSkillList(skills);
  // Server truth takes back over the moment the refreshed inventory agrees; the
  // state is pruned too, so a settled override cannot resurface when another
  // device changes the same link later.
  useEffect(() => {
    setLinkOverrides((current) => pruneSettledLinkOverrides(current, skills));
  }, [skills]);
  const activeOverrides = useMemo(
    () => pruneSettledLinkOverrides(linkOverrides, skills),
    [linkOverrides, skills],
  );

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleRows = useMemo(
    () =>
      rows.filter(({ skill, exiting }) => {
        if (exiting || normalizedQuery.length === 0) return true;
        return (
          skill.name.toLowerCase().includes(normalizedQuery) ||
          skill.dirName.toLowerCase().includes(normalizedQuery) ||
          skill.displayPath.toLowerCase().includes(normalizedQuery) ||
          (skill.description?.toLowerCase().includes(normalizedQuery) ?? false)
        );
      }),
    [normalizedQuery, rows],
  );

  const handleToggleLocation = useCallback(
    async (skill: Skill, location: SkillLocation, enabled: boolean) => {
      if (environmentId === null) return;
      const key = linkOverrideKey(skill.id, location.key);
      setActionError(null);
      setLinkOverrides((current) => new Map(current).set(key, enabled));
      setPendingChips((current) => new Map(current).set(skill.id, location.key));
      const result = await setLocationEnabled({
        environmentId,
        input: { skillId: skill.id, locationKey: location.key, enabled },
      });
      setPendingChips((current) => {
        const next = new Map(current);
        next.delete(skill.id);
        return next;
      });
      if (result._tag === "Failure") {
        setLinkOverrides((current) => {
          const next = new Map(current);
          next.delete(key);
          return next;
        });
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setActionError(
            error instanceof Error
              ? error.message
              : `Could not ${enabled ? "add" : "remove"} ${skill.name} in ${location.title}.`,
          );
        }
      }
    },
    [environmentId, setLocationEnabled],
  );

  const handleUninstall = useCallback(
    async (skill: Skill) => {
      if (environmentId === null) return;
      const confirmed = await ensureLocalApi().dialogs.confirm(
        [
          `Remove "${skill.name}"?`,
          `This deletes ${skill.displayPath} on this environment and removes its links from every provider.`,
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
          setActionError(error instanceof Error ? error.message : "Could not remove the skill.");
        }
        return;
      }
      beginExit(skill);
    },
    [beginExit, environmentId, uninstallSkill],
  );

  return (
    <SettingsSection
      {...searchableSetting("skills-library")}
      title="Skills"
      icon={<PackageIcon className="size-4.5 text-muted-foreground" />}
      headerAction={
        environmentId === null ? null : (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Refresh skills"
            disabled={query.isPending}
            onClick={() => query.refresh()}
          >
            <RefreshCwIcon className={cn("size-3.5", query.isPending && "animate-spin")} />
          </Button>
        )
      }
    >
      <p className="px-3 pb-2 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
        Skill folders on this environment. A skill is on for a provider when that provider&rsquo;s
        CLI can see it.
      </p>
      {environmentId === null ? (
        <SkillListHint>Connect an environment to manage skills.</SkillListHint>
      ) : query.error !== null ? (
        <SkillListHint tone="error">{query.error}</SkillListHint>
      ) : query.data === null ? (
        <SkillListSkeleton rows={3} />
      ) : (
        <>
          {skills.length > SKILL_SEARCH_THRESHOLD ? (
            <div className="px-3 pb-2 sm:px-4">
              <Input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.currentTarget.value)}
                placeholder="Search skills…"
                aria-label="Search skills"
              />
            </div>
          ) : null}
          {rows.length === 0 ? (
            <SkillListHint>
              No skills yet. Find some below or drop a folder with a SKILL.md into ~/.agents/skills.
            </SkillListHint>
          ) : visibleRows.length === 0 ? (
            <SkillListHint>No skills match.</SkillListHint>
          ) : (
            visibleRows.map(({ skill, exiting }) => (
              <SkillRowShell
                key={skill.id}
                skillId={skill.id}
                exiting={exiting}
                pending={uninstallingIds.has(skill.id)}
                onExited={finishExit}
              >
                <SkillRow
                  skill={skill}
                  locations={locations}
                  providerLocations={providerLocations}
                  overrides={activeOverrides}
                  pendingLocationKey={pendingChips.get(skill.id) ?? null}
                  uninstalling={uninstallingIds.has(skill.id)}
                  onToggleLocation={(location, enabled) =>
                    void handleToggleLocation(skill, location, enabled)
                  }
                  onUninstall={() => void handleUninstall(skill)}
                />
              </SkillRowShell>
            ))
          )}
        </>
      )}
      {actionError !== null ? <SkillListHint tone="error">{actionError}</SkillListHint> : null}
    </SettingsSection>
  );
}

function SkillRow({
  skill,
  locations,
  providerLocations,
  overrides,
  pendingLocationKey,
  uninstalling,
  onToggleLocation,
  onUninstall,
}: {
  skill: Skill;
  locations: ReadonlyArray<SkillLocation>;
  providerLocations: ReadonlyArray<SkillLocation>;
  overrides: ReadonlyMap<string, boolean>;
  pendingLocationKey: string | null;
  uninstalling: boolean;
  onToggleLocation: (location: SkillLocation, enabled: boolean) => void;
  onUninstall: () => void;
}) {
  const busy = uninstalling || pendingLocationKey !== null;

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
          {skill.dirName === skill.name ? null : (
            <code className="truncate font-mono text-[11px] text-muted-foreground/70">
              {skill.dirName}
            </code>
          )}
          {skill.source === undefined ? null : (
            <Badge variant="outline" size="sm" className="text-muted-foreground">
              {skill.source.repo}
            </Badge>
          )}
        </div>
        <p className="truncate text-[13px] leading-[1.45] text-muted-foreground/80">
          {skill.description ?? "No description."}
        </p>
        <p className="truncate font-mono text-[11px] text-muted-foreground/60">
          {skill.displayPath}
        </p>
      </div>
      <div className="flex max-w-[60%] flex-wrap items-center justify-end gap-1">
        {providerLocations.map((location) => (
          <SkillLocationChip
            key={location.key}
            skill={skill}
            location={location}
            locations={locations}
            state={skillChipState(
              skill,
              location,
              overrides.get(linkOverrideKey(skill.id, location.key)),
            )}
            pending={pendingLocationKey === location.key}
            disabled={busy}
            onToggle={(enabled) => onToggleLocation(location, enabled)}
          />
        ))}
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={uninstalling ? `Removing ${skill.name}` : `Remove ${skill.name}`}
        disabled={busy}
        onClick={onUninstall}
        className="shrink-0 text-muted-foreground hover:text-destructive-foreground"
      >
        {uninstalling ? (
          <LoaderCircleIcon className="size-4 animate-spin" />
        ) : (
          <Trash2Icon className="size-4" />
        )}
      </Button>
    </div>
  );
}

/**
 * One provider's on/off chip for a skill. Locked chips keep hover and focus
 * (`aria-disabled`, not `disabled`) so the tooltip can say why they cannot move.
 */
function SkillLocationChip({
  skill,
  location,
  locations,
  state,
  pending,
  disabled,
  onToggle,
}: {
  skill: Skill;
  location: SkillLocation;
  locations: ReadonlyArray<SkillLocation>;
  state: SkillChipState;
  pending: boolean;
  disabled: boolean;
  onToggle: (enabled: boolean) => void;
}) {
  const on = state !== "off";
  const lockReason =
    state === "home"
      ? `Lives here. Remove the skill to take it out of ${location.title}.`
      : state === "inherited"
        ? `${location.title} reads ${
            locations.find(
              (candidate) =>
                candidate.key !== location.key &&
                location.reads.includes(candidate.key) &&
                skill.presentIn.includes(candidate.key),
            )?.displayPath ?? "a shared folder"
          } directly.`
        : null;

  const chip = (
    <Button
      size="xs"
      variant={on ? "secondary" : "outline"}
      aria-pressed={on}
      aria-disabled={lockReason !== null || undefined}
      aria-label={`${location.title}: ${on ? "on" : "off"} for ${skill.name}`}
      disabled={disabled}
      onClick={lockReason === null ? () => onToggle(state === "off") : undefined}
      className={cn(
        "font-normal",
        lockReason !== null && "cursor-default",
        state === "inherited" && "opacity-64",
        state === "off" && "text-muted-foreground",
      )}
    >
      {pending ? <LoaderCircleIcon className="size-3 animate-spin" /> : null}
      {location.title}
    </Button>
  );

  if (lockReason === null) return chip;
  return (
    <Tooltip>
      <TooltipTrigger render={chip} />
      <TooltipPopup>{lockReason}</TooltipPopup>
    </Tooltip>
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
      title="Find skills"
      icon={<StoreIcon className="size-4.5 text-muted-foreground" />}
    >
      <p className="px-3 pb-2 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
        Browse skill repositories on GitHub. Installs go to ~/.agents/skills and are linked into
        every provider.
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
            In library
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
