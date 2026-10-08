import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ServerConfig,
  ServerProvider,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  AuthTerminalOperateScope,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ArrowRightIcon, CheckIcon, TerminalIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { TYPOGRAPHY_ADVANCED_STORAGE_KEY } from "../../appearanceFonts";
import { useLocalStorage } from "../../hooks/useLocalStorage";
import { randomUUID } from "../../lib/utils";
import {
  getOnboardingProviderState,
  resolveOnboardingProviderInstallCommand,
  resolveOnboardingProviderLoginCommand,
  selectOnboardingProvidersByDriver,
} from "../../onboarding/providerReadiness.logic";
import { useEnvironments } from "../../state/environments";
import { readEnvironmentScope, useEnvironmentScope } from "../../state/session";
import { serverEnvironment } from "../../state/server";
import { terminalEnvironment } from "../../state/terminal";
import { useAtomCommand } from "../../state/use-atom-command";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { AddManagedCodexAccountDialog, CodexSetupSection } from "../settings/CodexSetupSection";
import { readCodexSetupMode } from "../settings/CodexSetupSection.logic";
import { getDriverOption } from "../settings/providerDriverMeta";
import { getProviderSummary } from "../settings/providerStatus";
import { buildProviderInstanceUpdatePatch } from "../settings/SettingsPanels.logic";
import { TerminalViewport } from "../ThreadTerminalDrawer";
import { Button } from "../ui/button";
import { TrailheadCardBody, TrailheadCardFooter, TrailheadHeading } from "./TrailheadParts";

const AGENT_ONBOARDING_THREAD_ID = ThreadId.make("onboarding-agent-setup");

/**
 * Waypoint 2. Claude Code and Codex on each computer: managed Codex setup,
 * or an inline terminal with the vendor install / login command typed in.
 */
export function TrailheadAgents({
  environmentIds,
  onContinue,
}: {
  readonly environmentIds: readonly EnvironmentId[];
  readonly onContinue: () => void;
}) {
  const { environments } = useEnvironments();
  return (
    <>
      <TrailheadCardBody>
        <TrailheadHeading step="ridge" title="Rope in your agents.">
          Sign in to at least one. Others can join later from Settings.
        </TrailheadHeading>
        <div className="mt-6 space-y-6">
          {environmentIds.map((environmentId) => (
            <ConnectedAgentsStep
              key={environmentId}
              environmentId={environmentId}
              machineLabel={
                environmentIds.length > 1
                  ? (environments.find((environment) => environment.environmentId === environmentId)
                      ?.label ?? "Computer")
                  : null
              }
            />
          ))}
        </div>
      </TrailheadCardBody>
      <TrailheadCardFooter>
        <Button size="lg" autoFocus onClick={onContinue}>
          Continue
          <ArrowRightIcon className="size-3.5" />
        </Button>
      </TrailheadCardFooter>
    </>
  );
}

const PRIMARY_AGENT_DRIVERS = ["codex", "claudeAgent"] as const;
type OnboardingAgentDriver = (typeof PRIMARY_AGENT_DRIVERS)[number];

/** Setup values stay fixed while provider probes refresh the surrounding cards. */
interface AgentTerminalSession {
  readonly environmentId: EnvironmentId;
  readonly driver: OnboardingAgentDriver;
  readonly providerInstanceId: ServerProvider["instanceId"];
  readonly cwd: string;
  readonly command: string;
  readonly keybindings: ServerConfig["keybindings"];
}

function ConnectedAgentsStep({
  environmentId,
  machineLabel,
}: {
  readonly environmentId: EnvironmentId;
  /** Shown only when several computers are being set up. */
  readonly machineLabel: string | null;
}) {
  const providers = useAtomValue(serverEnvironment.providersValueAtom(environmentId));
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const serverConfig = useAtomValue(serverEnvironment.configValueAtom(environmentId));
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  const [terminalSession, setTerminalSession] = useState<AgentTerminalSession | null>(null);
  const [addingAccount, setAddingAccount] = useState(false);
  const [createdAccount, setCreatedAccount] = useState<{
    instanceId: ProviderInstanceId;
    displayName: string;
    autoStart: boolean;
  } | null>(null);

  // Re-probe on entry so freshly installed CLIs show up without a manual
  // refresh; harmless when nothing changed (single-flighted per environment).
  useEffect(() => {
    void refreshProviders({ environmentId, input: {} });
  }, [environmentId, refreshProviders]);

  const byDriver = useMemo(() => selectOnboardingProvidersByDriver(providers), [providers]);

  const primaryAgents = PRIMARY_AGENT_DRIVERS.flatMap((driver) => {
    const instances =
      driver === "codex" ? providers?.filter((provider) => provider.driver === driver) : undefined;
    return instances?.length
      ? instances.map((provider) => ({ driver, provider, instanceId: provider.instanceId }))
      : [{ driver, provider: byDriver.get(driver), instanceId: byDriver.get(driver)?.instanceId }];
  });
  // Keep the newly created row mounted while settings and provider snapshots catch up.
  if (createdAccount) {
    const index = primaryAgents.findIndex(
      (agent) => agent.instanceId === createdAccount.instanceId,
    );
    const [existing] = index >= 0 ? primaryAgents.splice(index, 1) : [];
    primaryAgents.unshift(
      existing ?? {
        driver: "codex",
        provider: undefined,
        instanceId: createdAccount.instanceId,
      },
    );
  }
  return (
    <section>
      {machineLabel ? (
        <h2 data-trailhead="ledger-label" className="mb-2">
          {machineLabel}
        </h2>
      ) : null}
      {canOperateTerminal ? null : (
        <p className="mb-2 text-xs text-muted-foreground" role="status">
          This connection cannot control terminals.
        </p>
      )}
      <div className="space-y-1.5">
        {primaryAgents.map(({ driver, provider, instanceId }) =>
          driver === "codex" && serverConfig !== null ? (
            <OnboardingCodexSetup
              key={instanceId ?? driver}
              environmentId={environmentId}
              provider={provider}
              serverConfig={serverConfig}
              createdAccount={instanceId === createdAccount?.instanceId ? createdAccount : null}
              onAutoStartConsumed={() =>
                setCreatedAccount((account) => (account ? { ...account, autoStart: false } : null))
              }
              terminalOpen={terminalSession?.driver === driver}
              terminalAvailable={canOperateTerminal}
              onOpenTerminal={() => {
                if (
                  provider === undefined ||
                  !readEnvironmentScope(environmentId, AuthTerminalOperateScope)
                ) {
                  return;
                }
                setTerminalSession({
                  environmentId,
                  driver,
                  providerInstanceId: provider.instanceId,
                  cwd: serverConfig.cwd,
                  command: provider.installed
                    ? resolveOnboardingProviderLoginCommand(
                        provider,
                        serverConfig.settings,
                        serverConfig.environment.platform.os,
                      )
                    : resolveOnboardingProviderInstallCommand(
                        driver,
                        serverConfig.environment.platform.os,
                      ),
                  keybindings: serverConfig.keybindings,
                });
              }}
            />
          ) : (
            <AgentCard
              key={driver}
              driver={driver}
              provider={provider}
              terminalOpen={terminalSession?.driver === driver}
              terminalAvailable={serverConfig !== null && canOperateTerminal}
              onOpenTerminal={() => {
                if (
                  provider === undefined ||
                  serverConfig === null ||
                  !readEnvironmentScope(environmentId, AuthTerminalOperateScope)
                ) {
                  return;
                }
                setTerminalSession({
                  environmentId,
                  driver,
                  providerInstanceId: provider.instanceId,
                  cwd: serverConfig.cwd,
                  command: provider.installed
                    ? resolveOnboardingProviderLoginCommand(
                        provider,
                        serverConfig.settings,
                        serverConfig.environment.platform.os,
                      )
                    : resolveOnboardingProviderInstallCommand(
                        driver,
                        serverConfig.environment.platform.os,
                      ),
                  keybindings: serverConfig.keybindings,
                });
              }}
            />
          ),
        )}
      </div>
      {providers?.some(
        (provider) =>
          provider.driver === "codex" && getOnboardingProviderState(provider) === "ready",
      ) ? (
        <div className="mt-3">
          <Button size="xs" variant="ghost-muted" onClick={() => setAddingAccount(true)}>
            Connect another ChatGPT account
          </Button>
        </div>
      ) : null}
      {addingAccount ? (
        <AddManagedCodexAccountDialog
          environmentId={environmentId}
          onClose={() => setAddingAccount(false)}
          onAccountCreated={(instanceId, displayName) =>
            setCreatedAccount({ instanceId, displayName, autoStart: true })
          }
        />
      ) : null}
      {terminalSession !== null ? (
        <AgentInstallTerminal
          key={`${terminalSession.environmentId}:${terminalSession.providerInstanceId}:${terminalSession.driver}`}
          session={terminalSession}
          onClose={() => {
            setTerminalSession(null);
            void refreshProviders({ environmentId, input: {} });
          }}
        />
      ) : null}
    </section>
  );
}

function OnboardingCodexSetup({
  createdAccount,
  onAutoStartConsumed,
  environmentId,
  provider,
  serverConfig,
  terminalOpen,
  terminalAvailable,
  onOpenTerminal,
}: {
  readonly environmentId: EnvironmentId;
  readonly provider: ServerProvider | undefined;
  readonly serverConfig: ServerConfig;
  readonly terminalOpen: boolean;
  readonly terminalAvailable: boolean;
  readonly onOpenTerminal: () => void;
  readonly createdAccount: {
    instanceId: ProviderInstanceId;
    displayName: string;
    autoStart: boolean;
  } | null;
  readonly onAutoStartConsumed: () => void;
}) {
  const update = useAtomCommand(serverEnvironment.updateSettings, "Codex setup settings");
  const instanceId =
    createdAccount?.instanceId ??
    provider?.instanceId ??
    defaultInstanceIdForDriver(ProviderDriverKind.make("codex"));
  const settings = serverConfig.settings;
  const instance = settings.providerInstances[instanceId] ?? {
    driver: ProviderDriverKind.make("codex"),
    enabled: settings.providers.codex.enabled,
    config: createdAccount ? { enabled: true, setupMode: "managed" } : settings.providers.codex,
  };
  const mode = readCodexSetupMode(instance.config);
  const existingChosen =
    mode === "existing" &&
    instance.config !== null &&
    typeof instance.config === "object" &&
    "setupMode" in instance.config &&
    instance.config.setupMode === "existing";
  const changeMode = (setupMode: "managed" | "existing") => {
    void update({
      environmentId,
      input: {
        patch: buildProviderInstanceUpdatePatch({
          settings,
          instanceId,
          driver: ProviderDriverKind.make("codex"),
          isDefault: instanceId === defaultInstanceIdForDriver(ProviderDriverKind.make("codex")),
          instance: {
            ...instance,
            enabled: true,
            config: {
              ...(instance.config !== null && typeof instance.config === "object"
                ? instance.config
                : {}),
              enabled: true,
              setupMode,
            },
          },
        }),
      },
    });
  };
  return existingChosen ? (
    <AgentCard
      driver="codex"
      provider={provider}
      terminalOpen={terminalOpen}
      terminalAvailable={terminalAvailable}
      onOpenTerminal={onOpenTerminal}
    />
  ) : (
    <CodexSetupSection
      presentation="onboarding"
      autoStart={createdAccount?.autoStart === true}
      displayName={createdAccount?.displayName}
      onAutoStartConsumed={onAutoStartConsumed}
      environmentId={environmentId}
      instanceId={instanceId}
      provider={provider}
      mode={mode}
      enabled={provider?.enabled ?? true}
      onModeChange={changeMode}
    />
  );
}

function AgentCard({
  driver,
  provider,
  terminalOpen,
  terminalAvailable,
  onOpenTerminal,
}: {
  readonly driver: OnboardingAgentDriver;
  readonly provider: ServerProvider | undefined;
  readonly terminalOpen: boolean;
  readonly terminalAvailable: boolean;
  readonly onOpenTerminal: () => void;
}) {
  const meta = getDriverOption(ProviderDriverKind.make(driver));
  const displayName =
    provider?.displayName || (driver === "claudeAgent" ? "Claude Code" : (meta?.label ?? driver));
  const summary = getProviderSummary(provider);
  const providerState = getOnboardingProviderState(provider);

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/40 px-4 py-3.5">
      <ProviderInstanceIcon
        driverKind={ProviderDriverKind.make(driver)}
        displayName={displayName}
        iconClassName="size-5"
      />
      <div className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{displayName}</span>
        <p className="mt-0.5 text-xs leading-relaxed break-words whitespace-pre-wrap text-muted-foreground">
          {providerState === "ready" ? "Ready to code." : summary.headline}
          {providerState !== "ready" && summary.detail ? ` · ${summary.detail}` : ""}
        </p>
      </div>
      <div className="shrink-0">
        {providerState === "ready" ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-foreground">
            <CheckIcon className="size-3.5" />
            Ready
          </span>
        ) : providerState === "checking" ? (
          <span className="text-xs text-muted-foreground">Checking...</span>
        ) : providerState === "disabled" ? (
          <span className="text-xs text-muted-foreground">Disabled</span>
        ) : providerState === "attention" ? (
          <span className="text-xs text-muted-foreground">{summary.headline}</span>
        ) : (
          <Button
            size="xs"
            variant="ghost"
            onClick={onOpenTerminal}
            disabled={terminalOpen || !terminalAvailable}
          >
            <TerminalIcon className="size-3.5" />
            {providerState === "signIn" ? "Sign in" : "Install"}
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Inline install terminal. Opens a PTY on the connected environment under a
 * synthetic onboarding thread id (terminals are keyed by free-form thread id;
 * the server validates only the cwd) and pre-types the install or login
 * command without submitting, so the user reviews and presses Enter.
 */
function AgentInstallTerminal({
  session,
  onClose,
}: {
  readonly session: AgentTerminalSession;
  readonly onClose: () => void;
}) {
  const { command, cwd, driver, environmentId, keybindings, providerInstanceId } = session;
  const canOperateTerminal = useEnvironmentScope(environmentId, AuthTerminalOperateScope);
  // Same terminal typography preference the thread drawer honors.
  const [advancedTypography] = useLocalStorage(
    TYPOGRAPHY_ADVANCED_STORAGE_KEY,
    false,
    Schema.Boolean,
  );
  const openTerminal = useAtomCommand(terminalEnvironment.open, { reportFailure: false });
  const writeTerminal = useAtomCommand(terminalEnvironment.write, { reportFailure: false });
  const closeTerminal = useAtomCommand(terminalEnvironment.close, { reportFailure: false });
  const setupQueueRef = useRef(Promise.resolve());
  const setupGenerationRef = useRef(0);
  const activeSetupGenerationRef = useRef<number | null>(null);
  const [terminalId] = useState(() => `onboarding-${driver}-${randomUUID()}`);
  const threadRef = useMemo(
    () => scopeThreadRef(environmentId, AGENT_ONBOARDING_THREAD_ID),
    [environmentId],
  );
  const [setupAttempt, setSetupAttempt] = useState(0);
  const [setupState, setSetupState] = useState<
    "preparing" | "ready" | "openFailed" | "writeFailed"
  >("preparing");
  const terminalReady = setupState === "ready" || setupState === "writeFailed";

  // Keep each setup generation distinct. In Strict Mode, a canceled open can
  // finish after the replacement setup starts; it must not close or pre-type
  // into the replacement session that shares this terminal id.
  useEffect(() => {
    const generation = setupGenerationRef.current + 1;
    setupGenerationRef.current = generation;
    activeSetupGenerationRef.current = generation;
    setSetupState("preparing");

    setupQueueRef.current = setupQueueRef.current.then(async () => {
      if (activeSetupGenerationRef.current !== generation) return;
      if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
        setSetupState("openFailed");
        return;
      }
      const opened = await openTerminal({
        environmentId,
        input: {
          threadId: AGENT_ONBOARDING_THREAD_ID,
          terminalId,
          cwd,
          providerInstanceId,
        },
      });
      if (opened._tag !== "Success") {
        if (activeSetupGenerationRef.current === generation) setSetupState("openFailed");
        return;
      }

      if (activeSetupGenerationRef.current !== generation) return;
      if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
        setSetupState("writeFailed");
        return;
      }

      const wrote = await writeTerminal({
        environmentId,
        input: { threadId: AGENT_ONBOARDING_THREAD_ID, terminalId, data: command },
      });
      if (activeSetupGenerationRef.current !== generation) return;
      setSetupState(wrote._tag === "Success" ? "ready" : "writeFailed");
    });

    // Every exit path unmounts the drawer. Close the PTY only while this
    // connection still has terminal access; revocation leaves it running.
    return () => {
      if (activeSetupGenerationRef.current === generation) {
        activeSetupGenerationRef.current = null;
      }
      setupQueueRef.current = setupQueueRef.current.then(async () => {
        if (!readEnvironmentScope(environmentId, AuthTerminalOperateScope)) return;
        await closeTerminal({
          environmentId,
          input: { threadId: AGENT_ONBOARDING_THREAD_ID, terminalId, deleteHistory: true },
        });
      });
    };
  }, [
    closeTerminal,
    command,
    cwd,
    environmentId,
    openTerminal,
    providerInstanceId,
    setupAttempt,
    terminalId,
    writeTerminal,
  ]);

  return (
    <div
      data-thread-terminal-drawer
      className="mt-4 overflow-hidden rounded-xl border border-border/70 bg-background text-foreground"
    >
      <div className="flex items-center justify-between border-b border-border/60 bg-background/60 px-3 py-1.5">
        <span className="text-2xs font-medium text-muted-foreground">
          {!canOperateTerminal ? (
            "This connection cannot control terminals."
          ) : setupState === "writeFailed" ? (
            <>
              Run <code className="rounded bg-muted px-1 font-mono">{command}</code> in this
              terminal.
            </>
          ) : setupState === "ready" ? (
            "Review the command, then press Enter to run it."
          ) : setupState === "openFailed" ? (
            "Could not open the setup terminal."
          ) : (
            "Preparing command..."
          )}
        </span>
        <div className="flex items-center gap-1">
          {setupState === "openFailed" ? (
            <Button
              size="xs"
              variant="ghost"
              disabled={!canOperateTerminal}
              onClick={() => {
                if (readEnvironmentScope(environmentId, AuthTerminalOperateScope)) {
                  setSetupAttempt((value) => value + 1);
                }
              }}
            >
              Retry
            </Button>
          ) : null}
          <Button size="xs" variant="ghost-muted" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
      <div className="h-64">
        {terminalReady ? (
          <TerminalViewport
            threadRef={threadRef}
            threadId={AGENT_ONBOARDING_THREAD_ID}
            terminalId={terminalId}
            terminalLabel={`Install ${driver}`}
            cwd={cwd}
            providerInstanceId={providerInstanceId}
            advancedTypography={advancedTypography}
            onSessionExited={onClose}
            focusRequestId={1}
            autoFocus
            visible
            resizeEpoch={0}
            drawerHeight={256}
            keybindings={keybindings}
          />
        ) : null}
      </div>
    </div>
  );
}
