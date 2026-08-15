/**
 * Settings › Skills — the server-managed skill registry: installed skills with
 * a global on/off per skill, marketplace listings browsed from configured
 * GitHub repository sources, host-folder skills the provider CLIs installed
 * themselves (uninstallable), and a read-only view of plugin/project/system
 * skills those CLIs still report. Install/uninstall/refresh go through the
 * skills RPC commands; enablement and sources are patched into server settings.
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
  SkillMarketplaceListing,
  SkillsState,
} from "@t3tools/contracts";
import {
  LaptopIcon,
  PackageIcon,
  PlusIcon,
  RefreshCwIcon,
  StoreIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useCallback, useMemo, useState, type ReactNode } from "react";

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

const SKILL_REPO_PATTERN = /^[^\s/]+\/[^\s/]+$/;

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

function InstalledSkillsSection({
  environmentId,
  query,
}: {
  environmentId: EnvironmentId | null;
  query: EnvironmentQueryView<SkillsState>;
}) {
  const settings = usePrimarySettings();
  const updateSettings = useUpdatePrimarySettings();
  const uninstallSkill = useAtomCommand(skillsEnvironment.uninstallSkill, {
    reportFailure: false,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);

  const enabledSkillIds = settings.skills.enabledSkillIds;
  const setSkillEnabled = useCallback(
    (skillId: string, enabled: boolean) => {
      const next = enabled
        ? enabledSkillIds.includes(skillId)
          ? enabledSkillIds
          : [...enabledSkillIds, skillId]
        : enabledSkillIds.filter((id) => id !== skillId);
      updateSettings({ skills: { enabledSkillIds: next } });
    },
    [enabledSkillIds, updateSettings],
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
      setUninstallingId(skill.id);
      const result = await uninstallSkill({ environmentId, input: { skillId: skill.id } });
      setUninstallingId(null);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setActionError(error instanceof Error ? error.message : "Could not uninstall the skill.");
        }
        return;
      }
      // Drop the orphaned enablement so the id does not linger in settings.
      if (enabledSkillIds.includes(skill.id)) {
        updateSettings({
          skills: { enabledSkillIds: enabledSkillIds.filter((id) => id !== skill.id) },
        });
      }
    },
    [enabledSkillIds, environmentId, uninstallSkill, updateSettings],
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
      ) : query.data.installedSkills.length === 0 ? (
        <SkillListHint>No skills installed yet — find some in the marketplace below.</SkillListHint>
      ) : (
        query.data.installedSkills.map((skill) => (
          <InstalledSkillRow
            key={skill.id}
            skill={skill}
            enabled={enabledSkillIds.includes(skill.id)}
            pending={uninstallingId === skill.id}
            onToggle={(enabled) => setSkillEnabled(skill.id, enabled)}
            onUninstall={() => void handleUninstall(skill)}
          />
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
    <div className="flex w-full items-center gap-3 rounded-xl px-3 py-3 sm:px-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/60 text-foreground">
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
          aria-label={`Enable ${skill.name} for every thread`}
        />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Uninstall ${skill.name}`}
          disabled={pending}
          onClick={onUninstall}
          className="text-muted-foreground hover:text-destructive-foreground"
        >
          <Trash2Icon className="size-4" />
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
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [refreshingRepo, setRefreshingRepo] = useState<string | null>(null);

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
      setInstallingId(skill.id);
      const result = await installSkill({ environmentId, input: { skillId: skill.id } });
      setInstallingId(null);
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
      setRefreshingRepo(repo);
      const result = await refreshMarketplace({ environmentId, input: { repo } });
      setRefreshingRepo(null);
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
          {query.error !== null ? (
            <SkillListHint tone="error">{query.error}</SkillListHint>
          ) : listings === null ? (
            <SkillListSkeleton rows={3} />
          ) : sources.length === 0 ? (
            <SkillListHint>No repositories configured — add one below.</SkillListHint>
          ) : (
            sources.map((source) => {
              const listing = listings.find((entry) => entry.repo === source.repo);
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
                        disabled={refreshingRepo === source.repo}
                        onClick={() => void handleRefresh(source.repo)}
                      >
                        <RefreshCwIcon
                          className={cn(
                            "size-3.5",
                            refreshingRepo === source.repo && "animate-spin",
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
                        installing={installingId === skill.id}
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
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [uninstallingId, setUninstallingId] = useState<string | null>(null);

  const skills = query.data?.skills ?? [];
  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleSkills = useMemo(
    () =>
      skills.filter(
        (skill) =>
          normalizedQuery.length === 0 ||
          skill.name.toLowerCase().includes(normalizedQuery) ||
          skill.origin.toLowerCase().includes(normalizedQuery) ||
          skill.displayPath.toLowerCase().includes(normalizedQuery) ||
          (skill.description?.toLowerCase().includes(normalizedQuery) ?? false),
      ),
    [normalizedQuery, skills],
  );
  const groups = useMemo(() => {
    const byOrigin = new Map<string, Array<HostSkill>>();
    for (const skill of visibleSkills) {
      const group = byOrigin.get(skill.origin) ?? [];
      group.push(skill);
      byOrigin.set(skill.origin, group);
    }
    return [...byOrigin.entries()];
  }, [visibleSkills]);

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
      setUninstallingId(skill.id);
      const result = await uninstallHostSkill({
        environmentId,
        input: { skillId: skill.id },
      });
      setUninstallingId(null);
      if (result._tag === "Failure") {
        if (!isAtomCommandInterrupted(result)) {
          const error = squashAtomCommandFailure(result);
          setActionError(error instanceof Error ? error.message : "Could not remove the skill.");
        }
        return;
      }
      void refreshProviders({ environmentId, input: {} });
    },
    [environmentId, refreshProviders, uninstallHostSkill],
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
        this environment — including over a remote connection. Removing one deletes that folder.
      </p>
      {environmentId === null ? (
        <SkillListHint>Connect an environment to manage provider skills.</SkillListHint>
      ) : query.error !== null ? (
        <SkillListHint tone="error">{query.error}</SkillListHint>
      ) : query.data === null ? (
        <SkillListSkeleton rows={3} />
      ) : (
        <>
          {skills.length > 0 ? (
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
          {skills.length === 0 ? (
            <SkillListHint>
              No provider CLI skills in their home folders. Marketplace installs land in T3&rsquo;s
              library above.
            </SkillListHint>
          ) : visibleSkills.length === 0 ? (
            <SkillListHint>No skills match.</SkillListHint>
          ) : (
            groups.map(([origin, originSkills]) => (
              <div key={origin} className="space-y-1 pt-1">
                <div className="px-3 py-1 sm:px-4">
                  <span className="truncate text-xs text-muted-foreground">{origin}</span>
                </div>
                {originSkills.map((skill) => (
                  <HostSkillRow
                    key={skill.id}
                    skill={skill}
                    pending={uninstallingId === skill.id}
                    onUninstall={() => void handleUninstall(skill)}
                  />
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
  onUninstall,
}: {
  skill: HostSkill;
  pending: boolean;
  onUninstall: () => void;
}) {
  return (
    <div className="flex w-full items-center gap-3 rounded-xl px-3 py-3 sm:px-4">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/60 text-foreground">
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
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove ${skill.name}`}
        disabled={pending}
        onClick={onUninstall}
        className="text-muted-foreground hover:text-destructive-foreground"
      >
        <Trash2Icon className="size-4" />
      </Button>
    </div>
  );
}

function DetectedSkillsSection({ hostSkills }: { hostSkills: ReadonlyArray<HostSkill> }) {
  const providers = useAtomValue(primaryServerProvidersAtom);
  const hostSkillPaths = useMemo(
    () => new Set(hostSkills.map((skill) => normalizeProviderSkillPath(skill.path))),
    [hostSkills],
  );
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
