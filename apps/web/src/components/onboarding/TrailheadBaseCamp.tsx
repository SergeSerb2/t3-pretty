import { useAuth } from "@clerk/react";
import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { ArrowRightIcon, ChevronRightIcon, CloudIcon, LinkIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { openClerkGate, useClerkGateOpen } from "../../cloud/clerkGate";
import { hasCloudPublicConfig } from "../../cloud/publicConfig";
import { connectPairing } from "../../connection/onboarding";
import { cn } from "../../lib/utils";
import { getOnboardingProviderState } from "../../onboarding/providerReadiness.logic";
import { isOnboardingRelayEnvironment } from "../../onboarding/targetEnvironment.logic";
import { resolveStepAfterBaseCamp } from "../../onboarding/trailhead.logic";
import type { useAgentSurveys } from "../../onboarding/useAgentSurveys";
import type { useProjectScans } from "../../onboarding/useProjectScans";
import { useEnvironments } from "../../state/environments";
import { useAtomCommand } from "../../state/use-atom-command";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { CloudEnvironmentConnectRows } from "../cloud/CloudEnvironmentConnectList";
import { getDriverOption } from "../settings/providerDriverMeta";
import { Alert, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { Input } from "../ui/input";
import {
  TrailheadCardBody,
  TrailheadCardFooter,
  TrailheadCommand,
  TrailheadHeading,
  TrailheadLedgerRow,
  type TrailheadGlyphState,
} from "./TrailheadParts";

type AgentSurveys = ReturnType<typeof useAgentSurveys>;
type ProjectScans = ReturnType<typeof useProjectScans>;

/**
 * Waypoint 1. Everything here is detected, not asked: the computers this
 * client already knows are picked, their agents are probed, and their agent
 * history is read in the background so later waypoints open with answers.
 */
export function TrailheadBaseCamp({
  localAvailable,
  selectedIds,
  autoSelectedComputers,
  agentSurveys,
  scans,
  onSelectionChange,
  onToggleEnvironment,
  onPaired,
  onContinue,
}: {
  readonly localAvailable: boolean;
  readonly selectedIds: ReadonlySet<EnvironmentId>;
  readonly autoSelectedComputers: Set<EnvironmentId>;
  readonly agentSurveys: AgentSurveys;
  readonly scans: ProjectScans;
  readonly onSelectionChange: (ids: ReadonlySet<EnvironmentId>) => void;
  readonly onToggleEnvironment: (environmentId: EnvironmentId, checked: boolean) => void;
  readonly onPaired: (environmentId: EnvironmentId) => void;
  readonly onContinue: (next: ReturnType<typeof resolveStepAfterBaseCamp>) => void;
}) {
  const { environments } = useEnvironments();
  const cloudEnabled = hasCloudPublicConfig();
  const directEnvironments = environments.filter(
    (environment) => !cloudEnabled || !isOnboardingRelayEnvironment(environment),
  );
  const [isPairing, setIsPairing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(!localAvailable);
  const selected = environments.filter((environment) => selectedIds.has(environment.environmentId));
  const ready =
    selected.length > 0 &&
    selected.every((environment) => environment.connection.phase === "connected");
  const next = resolveStepAfterBaseCamp(agentSurveys.map((entry) => entry.survey));
  const continueRef = useRef<HTMLButtonElement>(null);

  // Hand focus to Continue once the survey has something to continue with,
  // unless the user is already typing somewhere.
  useEffect(() => {
    if (ready && (document.activeElement === document.body || document.activeElement === null)) {
      continueRef.current?.focus();
    }
  }, [ready]);

  return (
    <>
      <TrailheadCardBody>
        <TrailheadHeading step="basecamp" title="Let’s see what you brought.">
          {directEnvironments.length > 0
            ? "T3 Pretty is surveying your computer for agents and recent work. Nothing changes until you continue."
            : "Pair the computer where your code lives. Agents run there; this window steers them."}
        </TrailheadHeading>

        <div data-trailhead="ledger">
          <ComputersRow
            environments={directEnvironments}
            selectedIds={selectedIds}
            onSelectionChange={onSelectionChange}
          />
          <AgentsRow agentSurveys={agentSurveys} next={next} />
          <HistoryRow scans={scans} />
        </div>

        <Collapsible open={moreOpen} onOpenChange={setMoreOpen} className="mt-4">
          <CollapsibleTrigger
            disabled={isPairing}
            render={<Button variant="ghost-muted" size="sm" className="-ml-2" />}
          >
            <ChevronRightIcon className={cn("size-3.5", moreOpen && "rotate-90")} />
            {directEnvironments.length > 0 ? "Bring another computer" : "Connect a computer"}
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <div className="mt-2 space-y-2 pb-2">
              {cloudEnabled ? (
                <ConnectAccountOption
                  autoSelectedComputers={autoSelectedComputers}
                  disabled={isPairing}
                  selectedIds={selectedIds}
                  onToggleEnvironment={onToggleEnvironment}
                />
              ) : null}
              <PairingOption
                defaultOpen={!localAvailable && !cloudEnabled}
                isPairing={isPairing}
                setIsPairing={setIsPairing}
                onPaired={(environmentId) => {
                  onPaired(environmentId);
                  requestAnimationFrame(() => continueRef.current?.focus());
                }}
              />
            </div>
          </CollapsiblePanel>
        </Collapsible>
      </TrailheadCardBody>
      <TrailheadCardFooter>
        <Button
          ref={continueRef}
          size="lg"
          disabled={!ready || isPairing}
          onClick={() => onContinue(next)}
        >
          {ready && next === "saddle" ? "Agents are ready — pick projects" : "Continue"}
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </TrailheadCardFooter>
    </>
  );
}

function ComputersRow({
  environments,
  selectedIds,
  onSelectionChange,
}: {
  readonly environments: ReturnType<typeof useEnvironments>["environments"];
  readonly selectedIds: ReadonlySet<EnvironmentId>;
  readonly onSelectionChange: (ids: ReadonlySet<EnvironmentId>) => void;
}) {
  const connected = environments.some(
    (environment) =>
      selectedIds.has(environment.environmentId) && environment.connection.phase === "connected",
  );
  const state: TrailheadGlyphState =
    environments.length === 0 ? "attention" : connected ? "ready" : "pending";
  return (
    <TrailheadLedgerRow label="Computer" state={state} order={0}>
      {environments.length === 0 ? (
        <span className="text-muted-foreground">None paired yet</span>
      ) : (
        <fieldset className="space-y-1.5">
          <legend className="sr-only">Computers to set up</legend>
          {environments.map((environment) => {
            const status =
              environment.connection.phase === "connected" ? "connected" : "connecting…";
            const body = (
              <span className="min-w-0">
                <span className="font-medium break-words">{environment.label}</span>
                <span className="text-muted-foreground"> · {status}</span>
              </span>
            );
            // A single computer is simply the one being set up.
            return environments.length === 1 ? (
              <div key={environment.environmentId}>{body}</div>
            ) : (
              <label
                key={environment.environmentId}
                className="flex cursor-pointer items-start gap-2"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={selectedIds.has(environment.environmentId)}
                  onCheckedChange={(checked) => {
                    const next = new Set(selectedIds);
                    if (checked) next.add(environment.environmentId);
                    else next.delete(environment.environmentId);
                    onSelectionChange(next);
                  }}
                />
                {body}
              </label>
            );
          })}
        </fieldset>
      )}
    </TrailheadLedgerRow>
  );
}

function providerLabel(provider: ServerProvider): string {
  if (provider.displayName) return provider.displayName;
  if (provider.driver === "claudeAgent") return "Claude Code";
  return getDriverOption(provider.driver)?.label ?? provider.driver;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function AgentsRow({
  agentSurveys,
  next,
}: {
  readonly agentSurveys: AgentSurveys;
  readonly next: ReturnType<typeof resolveStepAfterBaseCamp>;
}) {
  const readyNames = [
    ...new Set(
      agentSurveys.flatMap((entry) =>
        (entry.providers ?? [])
          .filter((provider) => getOnboardingProviderState(provider) === "ready")
          .map(providerLabel),
      ),
    ),
  ];
  const checking = agentSurveys.some((entry) => entry.survey === "checking");
  const state: TrailheadGlyphState =
    agentSurveys.length === 0 || (checking && readyNames.length === 0)
      ? "pending"
      : next === "saddle"
        ? "ready"
        : checking
          ? "pending"
          : "attention";
  return (
    <TrailheadLedgerRow label="Agents" state={state} order={1}>
      {agentSurveys.length === 0 ? (
        <span className="text-muted-foreground">Waiting for a computer</span>
      ) : readyNames.length === 0 ? (
        <span className="text-muted-foreground">
          {checking
            ? "Checking installed agents…"
            : "None signed in yet. The next stop fixes that."}
        </span>
      ) : (
        <span>
          {joinNames(readyNames)} {readyNames.length === 1 ? "is" : "are"} ready
          {next === "ridge" && !checking ? (
            <span className="text-muted-foreground"> · another computer needs one</span>
          ) : null}
        </span>
      )}
    </TrailheadLedgerRow>
  );
}

function HistoryRow({ scans }: { readonly scans: ProjectScans }) {
  const pending = scans.some((scan) => scan.isPending && scan.data === null);
  const failed = scans.filter((scan) => scan.error !== null);
  const candidates = scans.flatMap((scan) => scan.data?.candidates ?? []);
  const threads = candidates.reduce((total, candidate) => total + candidate.threadCount, 0);
  const state: TrailheadGlyphState =
    scans.length === 0 || pending ? "pending" : failed.length > 0 ? "attention" : "ready";
  return (
    <TrailheadLedgerRow label="History" state={state} order={2}>
      {scans.length === 0 ? (
        <span className="text-muted-foreground">Waiting for a computer</span>
      ) : pending ? (
        <span className="text-muted-foreground">Reading Claude Code and Codex history…</span>
      ) : candidates.length === 0 && failed.length === 0 ? (
        <span className="text-muted-foreground">No earlier projects. A clean trail.</span>
      ) : (
        <span>
          {candidates.length > 0
            ? `${candidates.length} ${candidates.length === 1 ? "project" : "projects"}, ${threads} ${threads === 1 ? "conversation" : "conversations"}`
            : null}
          {failed.length > 0 ? (
            <span className="text-muted-foreground">
              {candidates.length > 0 ? " · " : ""}
              Could not read every computer
            </span>
          ) : null}
        </span>
      )}
    </TrailheadLedgerRow>
  );
}

function ConnectAccountOption({
  autoSelectedComputers,
  disabled,
  selectedIds,
  onToggleEnvironment,
}: {
  readonly autoSelectedComputers: Set<EnvironmentId>;
  readonly disabled: boolean;
  readonly selectedIds: ReadonlySet<EnvironmentId>;
  readonly onToggleEnvironment: (environmentId: EnvironmentId, checked: boolean) => void;
}) {
  const clerkGateOpen = useClerkGateOpen();
  if (!clerkGateOpen) {
    return (
      <Button
        variant="outline"
        size="sm-multiline"
        disabled={disabled}
        className="w-full justify-start"
        onClick={() => openClerkGate({ promptSignIn: true })}
      >
        <CloudIcon className="size-4" />
        <span className="flex-1 text-left">T3 Connect</span>
        <span className="text-xs text-muted-foreground">Sign in</span>
      </Button>
    );
  }
  return (
    <SignedInConnectOption
      autoSelectedComputers={autoSelectedComputers}
      disabled={disabled}
      selectedIds={selectedIds}
      onToggleEnvironment={onToggleEnvironment}
    />
  );
}

function SignedInConnectOption({
  autoSelectedComputers,
  disabled,
  selectedIds,
  onToggleEnvironment,
}: {
  readonly autoSelectedComputers: Set<EnvironmentId>;
  readonly disabled: boolean;
  readonly selectedIds: ReadonlySet<EnvironmentId>;
  readonly onToggleEnvironment: (environmentId: EnvironmentId, checked: boolean) => void;
}) {
  const { environments } = useEnvironments();
  const { isLoaded, isSignedIn } = useAuth({ treatPendingAsSignedOut: false });
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const [expanded, setExpanded] = useState(true);
  const [discoveryReady, setDiscoveryReady] = useState(false);
  const onDiscoveryReady = useCallback(() => setDiscoveryReady(true), []);

  return (
    <div className="rounded-xl border border-border/70 bg-background/40">
      <Collapsible open={expanded && !!isSignedIn && discoveryReady} onOpenChange={setExpanded}>
        <CollapsibleTrigger
          disabled={disabled || !isLoaded}
          onClick={(event) => {
            if (!isSignedIn) {
              event.preventDefault();
              setExpanded(true);
              openAuthPrompt();
            }
          }}
          render={<Button variant="ghost" size="sm-multiline" className="w-full justify-start" />}
        >
          <CloudIcon className="size-4" />
          <span className="flex-1 text-left">T3 Connect</span>
          <span className="text-xs text-muted-foreground">
            {!isLoaded
              ? "Loading sign-in…"
              : !isSignedIn
                ? "Sign in"
                : !discoveryReady
                  ? "Finding computers…"
                  : null}
          </span>
        </CollapsibleTrigger>
        <CollapsiblePanel keepMounted>
          <div className="px-3 pb-3">
            {isSignedIn ? (
              <div className="mb-3 space-y-1.5">
                <CloudEnvironmentConnectRows
                  primaryEnvironmentId={null}
                  savedEnvironments={environments}
                  showSavedEnvironments
                  onDiscoveryReady={onDiscoveryReady}
                  selection={{ selectedIds, onChange: onToggleEnvironment, autoSelectedComputers }}
                  refreshWhileEmpty
                  empty={
                    <p className="py-2 text-sm text-muted-foreground">No computers linked yet.</p>
                  }
                />
              </div>
            ) : null}
            <p className="text-sm text-muted-foreground">
              Run this on each computer you want to bring along, and keep T3 Pretty running there.
            </p>
            <TrailheadCommand command="npx t3 connect" className="mt-2" />
          </div>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}

/** Register a computer in this client from a server-minted pairing link. */
function PairingOption({
  defaultOpen,
  isPairing,
  setIsPairing,
  onPaired,
}: {
  readonly defaultOpen: boolean;
  readonly isPairing: boolean;
  readonly setIsPairing: (value: boolean) => void;
  readonly onPaired: (environmentId: EnvironmentId) => void;
}) {
  const connectPairingEnvironment = useAtomCommand(connectPairing, { reportFailure: false });
  const [open, setOpen] = useState(defaultOpen);
  const [pairingUrl, setPairingUrl] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submit = async () => {
    if (isPairing || pairingUrl.trim().length === 0) return;
    setIsPairing(true);
    setErrorMessage("");
    const result = await connectPairingEnvironment({ pairingUrl: pairingUrl.trim() });
    if (!mountedRef.current) return;
    setIsPairing(false);
    if (result._tag === "Success") {
      setOpen(false);
      setPairingUrl("");
      onPaired(result.value);
      return;
    }
    if (isAtomCommandInterrupted(result)) return;
    const cause = squashAtomCommandFailure(result);
    setErrorMessage(cause instanceof Error ? cause.message : "Pairing failed.");
  };

  return (
    <div className="rounded-xl border border-border/70 bg-background/40">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger
          disabled={isPairing}
          render={<Button variant="ghost" size="sm-multiline" className="w-full justify-start" />}
        >
          <LinkIcon className="size-4" />
          <span className="flex-1 text-left">Pair with a link</span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <form
            className="space-y-3 px-3 pb-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="block text-sm text-muted-foreground" htmlFor="trailhead-pairing-url">
              Pairing link
            </label>
            <div className="flex gap-2">
              <Input
                id="trailhead-pairing-url"
                autoFocus
                aria-invalid={errorMessage.length > 0}
                aria-describedby={errorMessage ? "trailhead-pairing-error" : undefined}
                autoCapitalize="none"
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                nativeInput
                readOnly={isPairing}
                placeholder="https://your-server:5230/pair#token=…"
                value={pairingUrl}
                onChange={(event) => setPairingUrl(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    (event.nativeEvent.isComposing || event.keyCode === 229)
                  ) {
                    event.preventDefault();
                  }
                }}
              />
              <Button type="submit" disabled={isPairing || pairingUrl.trim().length === 0}>
                {isPairing ? "Pairing…" : "Pair"}
              </Button>
            </div>
            {errorMessage ? (
              <Alert id="trailhead-pairing-error" variant="error">
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            ) : null}
            <p className="text-sm text-muted-foreground">
              No link yet? Run this on the computer with your code. Add{" "}
              <code className="font-mono">--tailscale</code> to pair over your tailnet.
            </p>
            <TrailheadCommand command="npx t3 pair" />
          </form>
        </CollapsiblePanel>
      </Collapsible>
    </div>
  );
}
