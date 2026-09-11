import { useAtomValue } from "@effect/atom-react";
import type {
  EnvironmentAutomation,
  ScopedAutomationRef,
} from "@t3tools/client-runtime/state/automations";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  EnvironmentId,
  ScopedProjectRef,
  ScopedThreadRef,
  ServerConfig,
} from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";

import { automationEnvironment } from "./automations";
import { environmentProjects } from "./projects";
import { environmentServerConfigsAtom, serverEnvironment } from "./server";
import { environmentThreadShells } from "./threads";

const EMPTY_AUTOMATIONS: ReadonlyArray<EnvironmentAutomation> = Object.freeze([]);
const EMPTY_AUTOMATIONS_ATOM = Atom.make(EMPTY_AUTOMATIONS).pipe(
  Atom.withLabel("mobile-automations:empty"),
);
const EMPTY_AUTOMATION_ATOM = Atom.make<EnvironmentAutomation | null>(null).pipe(
  Atom.withLabel("mobile-automation:empty"),
);

const EMPTY_PROJECT_ATOM = Atom.make<EnvironmentProject | null>(null).pipe(
  Atom.withLabel("mobile-project:empty"),
);
const EMPTY_THREAD_SHELL_ATOM = Atom.make<EnvironmentThreadShell | null>(null).pipe(
  Atom.withLabel("mobile-thread-shell:empty"),
);
const EMPTY_SERVER_CONFIG_ATOM = Atom.make<ServerConfig | null>(null).pipe(
  Atom.withLabel("mobile-server-config:empty"),
);

export function useProjects(): ReadonlyArray<EnvironmentProject> {
  return useAtomValue(environmentProjects.projectsAtom);
}

/** Automation run threads are excluded; the automation surfaces use `useAllThreadShells`. */
export function useThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(environmentThreadShells.threadShellsAtom);
}

export function useAllThreadShells(): ReadonlyArray<EnvironmentThreadShell> {
  return useAtomValue(environmentThreadShells.allThreadShellsAtom);
}

/** Automations of one environment, or of every connected environment when omitted. */
export function useAutomations(
  environmentId?: EnvironmentId | null,
): ReadonlyArray<EnvironmentAutomation> {
  return useAtomValue(
    environmentId === undefined
      ? automationEnvironment.automationsAtom
      : environmentId === null
        ? EMPTY_AUTOMATIONS_ATOM
        : automationEnvironment.environmentAutomationsAtom(environmentId),
  );
}

export function useAutomationsForProject(
  ref: ScopedProjectRef | null,
): ReadonlyArray<EnvironmentAutomation> {
  return useAtomValue(
    ref === null ? EMPTY_AUTOMATIONS_ATOM : automationEnvironment.automationsForProjectAtom(ref),
  );
}

export function useAutomationShell(ref: ScopedAutomationRef | null): EnvironmentAutomation | null {
  return useAtomValue(
    ref === null ? EMPTY_AUTOMATION_ATOM : automationEnvironment.automationShellAtom(ref),
  );
}

export function useProject(ref: ScopedProjectRef | null): EnvironmentProject | null {
  return useAtomValue(ref === null ? EMPTY_PROJECT_ATOM : environmentProjects.projectAtom(ref));
}

export function useThreadShell(ref: ScopedThreadRef | null): EnvironmentThreadShell | null {
  return useAtomValue(
    ref === null ? EMPTY_THREAD_SHELL_ATOM : environmentThreadShells.threadShellAtom(ref),
  );
}

export function useEnvironmentServerConfig(
  environmentId: EnvironmentId | null,
): ServerConfig | null {
  return useAtomValue(
    environmentId === null
      ? EMPTY_SERVER_CONFIG_ATOM
      : serverEnvironment.configValueAtom(environmentId),
  );
}

export function useServerConfigs(): ReadonlyMap<EnvironmentId, ServerConfig> {
  return useAtomValue(environmentServerConfigsAtom);
}
