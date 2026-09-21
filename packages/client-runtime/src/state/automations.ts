// @effect-diagnostics globalDate:off -- Run history is grouped by calendar day in the viewer's zone and labelled from a caller-supplied "now".
/**
 * Automations state shared by web and mobile: the per-environment rows carried
 * on the shell snapshot, the paged run queries, the four orchestration
 * commands, and the pure presentation helpers both clients render.
 *
 * The row atoms are identity-stable — an automation object only changes when
 * the server sends `automation-upserted` for it — so `listRuns` can use a row
 * as its refresh trigger without refetching on every streamed token.
 */
import {
  AutomationId,
  AutomationRunId,
  CommandId,
  ORCHESTRATION_WS_METHODS,
  WS_METHODS,
  type AutomationRun,
  type AutomationRunStatus,
  type AutomationShell,
  type ClientOrchestrationCommand,
  type EnvironmentId,
  type OrchestrationShellSnapshot,
  type OrchestrationThreadShell,
  type ScopedProjectRef,
  type ThreadId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import { request } from "../rpc/client.ts";
import type { EnvironmentCatalogState } from "./connections.ts";
import { arrayElementsEqual, projectKey, parseProjectKey } from "./entities.ts";
import {
  createAtomCommandScheduler,
  createEnvironmentCommand,
  createEnvironmentRpcQueryAtomFamily,
} from "./runtime.ts";

export { nextRunPreview } from "@t3tools/shared/automationSchedule";

/** An automation row tagged with the environment it lives in, like `EnvironmentThreadShell`. */
export interface EnvironmentAutomation extends AutomationShell {
  readonly environmentId: EnvironmentId;
}

export interface ScopedAutomationRef {
  readonly environmentId: EnvironmentId;
  readonly automationId: AutomationId;
}

// ---------------------------------------------------------------------------
// Pure helpers (web and mobile share these; tested in automations.test.ts)
// ---------------------------------------------------------------------------

/**
 * Whether a thread is an automation run thread that the default thread lists
 * must hide. An orphaned run thread (its automation was deleted, or the row
 * has not arrived yet) stays visible so it is never unreachable.
 */
export function isAutomationRunThread(
  thread: Pick<OrchestrationThreadShell, "automationRun">,
  automations: ReadonlyMap<AutomationId, AutomationShell>,
): boolean {
  const run = thread.automationRun ?? null;
  return run !== null && automations.has(run.automationId);
}

export interface AutomationRunDayGroup {
  readonly key: string;
  readonly label: string;
  readonly runs: ReadonlyArray<AutomationRun>;
}

const dayKeyFormatter = (timeZone: string) =>
  // en-CA renders ISO-shaped YYYY-MM-DD, which sorts and compares as a key.
  new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

const DAY_MILLIS = 86_400_000;

/**
 * Groups runs (newest first) into calendar days of `timeZone`, labelling the
 * two most recent days in words. `nowIso` decides what "Today" means, so the
 * caller controls the clock and the result is deterministic.
 */
export function groupAutomationRunsByDay(
  runs: ReadonlyArray<AutomationRun>,
  nowIso: string,
  timeZone: string,
): ReadonlyArray<AutomationRunDayGroup> {
  if (runs.length === 0) {
    return [];
  }
  const keyOf = dayKeyFormatter(timeZone);
  const labelOf = new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric" });
  const labelWithYear = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const nowMs = Date.parse(nowIso);
  const todayKey = keyOf.format(nowMs);
  const yesterdayKey = keyOf.format(nowMs - DAY_MILLIS);
  const thisYear = todayKey.slice(0, 4);

  const groups: Array<{ key: string; label: string; runs: AutomationRun[] }> = [];
  for (const run of runs) {
    const at = Date.parse(run.requestedAt);
    const key = keyOf.format(at);
    const last = groups.at(-1);
    if (last !== undefined && last.key === key) {
      last.runs.push(run);
      continue;
    }
    const label =
      key === todayKey
        ? "Today"
        : key === yesterdayKey
          ? "Yesterday"
          : key.startsWith(thisYear)
            ? labelOf.format(at)
            : labelWithYear.format(at);
    groups.push({ key, label, runs: [run] });
  }
  return groups;
}

export type AutomationRunRow =
  | { readonly kind: "run"; readonly run: AutomationRun }
  | {
      readonly kind: "collapsed";
      readonly count: number;
      readonly skipped: number;
      readonly missed: number;
      readonly runs: ReadonlyArray<AutomationRun>;
    };

const COLLAPSIBLE_STATUSES: ReadonlySet<AutomationRunStatus> = new Set<AutomationRunStatus>([
  "completed",
  "skipped",
  "missed",
]);

const AUTOMATION_RUN_ROWS_KEPT = 3;

/**
 * Condenses one day group (newest first) for the run history: the three most
 * recent runs and every failure stay as rows, each remaining stretch of
 * uneventful runs collapses into one expandable row. A single leftover run is
 * cheaper to show than to collapse, so it stays a row.
 */
export function condenseAutomationRunGroup(
  runs: ReadonlyArray<AutomationRun>,
): ReadonlyArray<AutomationRunRow> {
  const rows: AutomationRunRow[] = [];
  let pending: AutomationRun[] = [];
  const flush = () => {
    if (pending.length === 0) {
      return;
    }
    if (pending.length === 1) {
      rows.push({ kind: "run", run: pending[0]! });
    } else {
      rows.push({
        kind: "collapsed",
        count: pending.length,
        skipped: pending.filter((run) => run.status === "skipped").length,
        missed: pending.filter((run) => run.status === "missed").length,
        runs: pending,
      });
    }
    pending = [];
  };
  runs.forEach((run, index) => {
    if (index < AUTOMATION_RUN_ROWS_KEPT || !COLLAPSIBLE_STATUSES.has(run.status)) {
      flush();
      rows.push({ kind: "run", run });
      return;
    }
    pending.push(run);
  });
  flush();
  return rows;
}

export type AutomationStatus = "running" | "needs-attention" | "failed" | "paused" | "idle";

type AutomationRunThreadShell = Pick<
  OrchestrationThreadShell,
  "hasPendingApprovals" | "hasPendingUserInput"
>;

function runThreadIsWaiting(thread: AutomationRunThreadShell | null): boolean {
  return thread !== null && (thread.hasPendingApprovals || thread.hasPendingUserInput);
}

/**
 * The single state a row renders. `activeRunThread` is the shell of
 * `shell.activeRun.threadId` when the client holds it; pass null otherwise.
 */
export function automationStatus(
  shell: AutomationShell,
  activeRunThread: AutomationRunThreadShell | null = null,
): AutomationStatus {
  if (shell.activeRun !== null && runThreadIsWaiting(activeRunThread)) {
    return "needs-attention";
  }
  if (shell.activeRun !== null) {
    return "running";
  }
  if (shell.lastRun?.status === "failed") {
    return "failed";
  }
  return shell.enabled ? "idle" : "paused";
}

/**
 * Whether this automation should add one to the inbox badge. Run threads are
 * hidden from the thread list, so the automation row is the clickable target
 * and the count clears when its thread is visited or the next run lands.
 * `lastRunThread` is null when the client does not hold the failed run's
 * thread (it never started one, or it was removed): nothing can be visited,
 * so nothing badges — the row's red dot still shows the failure.
 */
export function automationNeedsAttention(
  shell: AutomationShell,
  activeRunThread: AutomationRunThreadShell | null,
  lastRunThread: { readonly lastVisitedAt: string | null } | null,
): boolean {
  if (shell.activeRun !== null && runThreadIsWaiting(activeRunThread)) {
    return true;
  }
  const lastRun = shell.lastRun;
  if (lastRun === null || lastRun.status !== "failed" || lastRunThread === null) {
    return false;
  }
  const { lastVisitedAt } = lastRunThread;
  return (
    lastVisitedAt === null ||
    Date.parse(lastVisitedAt) < Date.parse(lastRun.finishedAt ?? lastRun.requestedAt)
  );
}

const MINUTE_MILLIS = 60_000;
const HOUR_MILLIS = 3_600_000;

/**
 * Countdown label for a future instant ("in 12m", "in 3h", "in 2d"). Past and
 * present both read "now", so a due-but-unstarted schedule never shows a
 * negative delay. Drive it from a shared minute tick, never a per-row timer.
 */
export function formatUntilLabel(iso: string, nowMs: number): string {
  const diff = Date.parse(iso) - nowMs;
  if (Number.isNaN(diff) || diff <= 0) {
    return "now";
  }
  const minutes = Math.round(diff / MINUTE_MILLIS);
  if (minutes < 60) {
    return `in ${Math.max(1, minutes)}m`;
  }
  const hours = Math.round(diff / HOUR_MILLIS);
  return hours < 48 ? `in ${hours}h` : `in ${Math.round(diff / DAY_MILLIS)}d`;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

type CommandOf<T extends ClientOrchestrationCommand["type"]> = Extract<
  ClientOrchestrationCommand,
  { readonly type: T }
>;
type AutomationCreateCommand = CommandOf<"automation.create">;
type AutomationUpdateCommand = CommandOf<"automation.update">;
type AutomationRunRequestCommand = CommandOf<"automation.run.request">;

/** `automationId` and the timestamps are minted here when the caller omits them. */
export type CreateAutomationInput = Omit<
  AutomationCreateCommand,
  "type" | "commandId" | "automationId" | "createdAt"
> & {
  readonly automationId?: AutomationId;
  readonly commandId?: CommandId;
  readonly createdAt?: AutomationCreateCommand["createdAt"];
};

export type UpdateAutomationInput = Omit<
  AutomationUpdateCommand,
  "type" | "commandId" | "updatedAt"
> & {
  readonly commandId?: CommandId;
  readonly updatedAt?: AutomationUpdateCommand["updatedAt"];
};

export type DeleteAutomationInput = Omit<CommandOf<"automation.delete">, "type" | "commandId"> & {
  readonly commandId?: CommandId;
};

/** Manual runs are allowed while paused; the server rejects only a second concurrent run. */
export type RunAutomationNowInput = {
  readonly automationId: AutomationId;
  readonly runId?: AutomationRunId;
  readonly commandId?: CommandId;
  readonly requestedAt?: AutomationRunRequestCommand["requestedAt"];
  /** Set when an agent triggered the run through the MCP toolkit. */
  readonly byThreadId?: ThreadId | null;
};

const randomUuid = Crypto.Crypto.pipe(
  Effect.flatMap((crypto) => crypto.randomUUIDv4),
  Effect.orDie,
);

const commandMetadata = Effect.fn("EnvironmentAutomations.commandMetadata")(function* (input: {
  readonly commandId?: CommandId;
  readonly at?: string;
}) {
  return {
    commandId: input.commandId ?? CommandId.make(yield* randomUuid),
    at: input.at ?? (yield* DateTime.now.pipe(Effect.map(DateTime.formatIso))),
  };
});

function dispatch(command: ClientOrchestrationCommand) {
  return request(ORCHESTRATION_WS_METHODS.dispatchCommand, command);
}

const createAutomation = Effect.fn("EnvironmentAutomations.create")(function* (
  input: CreateAutomationInput,
) {
  const { automationId, commandId, createdAt, ...fields } = input;
  const metadata = yield* commandMetadata({
    ...(commandId === undefined ? {} : { commandId }),
    ...(createdAt === undefined ? {} : { at: createdAt }),
  });
  return yield* dispatch({
    ...fields,
    type: "automation.create",
    automationId: automationId ?? AutomationId.make(yield* randomUuid),
    commandId: metadata.commandId,
    createdAt: metadata.at,
  });
});

const updateAutomation = Effect.fn("EnvironmentAutomations.update")(function* (
  input: UpdateAutomationInput,
) {
  const { commandId, updatedAt, ...fields } = input;
  const metadata = yield* commandMetadata({
    ...(commandId === undefined ? {} : { commandId }),
    ...(updatedAt === undefined ? {} : { at: updatedAt }),
  });
  return yield* dispatch({
    ...fields,
    type: "automation.update",
    commandId: metadata.commandId,
    updatedAt: metadata.at,
  });
});

const deleteAutomation = Effect.fn("EnvironmentAutomations.delete")(function* (
  input: DeleteAutomationInput,
) {
  const { commandId, ...fields } = input;
  const metadata = yield* commandMetadata(commandId === undefined ? {} : { commandId });
  return yield* dispatch({ ...fields, type: "automation.delete", commandId: metadata.commandId });
});

const runAutomationNow = Effect.fn("EnvironmentAutomations.runNow")(function* (
  input: RunAutomationNowInput,
) {
  const metadata = yield* commandMetadata({
    ...(input.commandId === undefined ? {} : { commandId: input.commandId }),
    ...(input.requestedAt === undefined ? {} : { at: input.requestedAt }),
  });
  return yield* dispatch({
    type: "automation.run.request",
    automationId: input.automationId,
    runId: input.runId ?? AutomationRunId.make(yield* randomUuid),
    trigger: { type: "manual", byThreadId: input.byThreadId ?? null },
    commandId: metadata.commandId,
    requestedAt: metadata.at,
  });
});

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------

const EMPTY_AUTOMATIONS: ReadonlyArray<AutomationShell> = Object.freeze([]);
const EMPTY_ENVIRONMENT_AUTOMATIONS: ReadonlyArray<EnvironmentAutomation> = Object.freeze([]);
const EMPTY_AUTOMATION_INDEX: ReadonlyMap<AutomationId, EnvironmentAutomation> = new Map();

// Keys are produced by these two functions only, so JSON round-tripping is
// enough; ids containing the separator survive it.
const automationKey = (ref: ScopedAutomationRef) =>
  JSON.stringify([ref.environmentId, ref.automationId]);
const parseAutomationKey = (key: string): ScopedAutomationRef => {
  const [environmentId, automationId] = JSON.parse(key) as [EnvironmentId, AutomationId];
  return { environmentId, automationId };
};

/** Runs of one automation, then by name: the order every surface lists them in. */
const byName = (left: AutomationShell, right: AutomationShell) =>
  left.name.localeCompare(right.name) || left.id.localeCompare(right.id);

/**
 * Automation rows, run pages, and the four commands for one client runtime.
 * `snapshotAtom` is the app's shell snapshot family (web and mobile both
 * already build one) and `catalogValueAtom` its connected environments.
 */
export function createAutomationEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | Crypto.Crypto | R, E>,
  input: {
    readonly snapshotAtom: (
      environmentId: EnvironmentId,
    ) => Atom.Atom<OrchestrationShellSnapshot | null>;
    readonly catalogValueAtom: Atom.Atom<EnvironmentCatalogState>;
  },
) {
  // One scoped row per source row, so a point read and every list share the
  // same object and unrelated rows keep their identity across updates.
  const scoped = new WeakMap<AutomationShell, Map<EnvironmentId, EnvironmentAutomation>>();
  const scopeAutomation = (environmentId: EnvironmentId, automation: AutomationShell) => {
    let byEnvironment = scoped.get(automation);
    if (byEnvironment === undefined) {
      byEnvironment = new Map();
      scoped.set(automation, byEnvironment);
    }
    let value = byEnvironment.get(environmentId);
    if (value === undefined) {
      value = { ...automation, environmentId };
      byEnvironment.set(environmentId, value);
    }
    return value;
  };

  // Reading the array off the snapshot in its own atom is what keeps thread
  // traffic away from the rows: the snapshot object changes on every
  // thread-touched, this value does not.
  const sourceAutomationsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make(
      (get): ReadonlyArray<AutomationShell> =>
        get(input.snapshotAtom(environmentId))?.automations ?? EMPTY_AUTOMATIONS,
    ).pipe(Atom.withLabel(`environment-automations-source:${environmentId}`)),
  );

  const environmentAutomationsAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ReadonlyArray<EnvironmentAutomation> => {
      const source = get(sourceAutomationsAtom(environmentId));
      if (source.length === 0) {
        return EMPTY_ENVIRONMENT_AUTOMATIONS;
      }
      return [...source]
        .sort(byName)
        .map((automation) => scopeAutomation(environmentId, automation));
    }).pipe(Atom.withLabel(`environment-automations:${environmentId}`)),
  );

  const automationIndexAtom = Atom.family((environmentId: EnvironmentId) =>
    Atom.make((get): ReadonlyMap<AutomationId, EnvironmentAutomation> => {
      const automations = get(environmentAutomationsAtom(environmentId));
      if (automations.length === 0) {
        return EMPTY_AUTOMATION_INDEX;
      }
      return new Map(automations.map((automation) => [automation.id, automation]));
    }).pipe(Atom.withLabel(`environment-automation-index:${environmentId}`)),
  );

  const automationShellAtomFamily = Atom.family((key: string) => {
    const ref = parseAutomationKey(key);
    return Atom.make(
      (get): EnvironmentAutomation | null =>
        get(automationIndexAtom(ref.environmentId)).get(ref.automationId) ?? null,
    ).pipe(Atom.withLabel(`environment-automation:${key}`));
  });

  const automationsForProjectAtomFamily = Atom.family((key: string) => {
    const ref = parseProjectKey(key);
    let previous: ReadonlyArray<EnvironmentAutomation> = EMPTY_ENVIRONMENT_AUTOMATIONS;
    return Atom.make((get): ReadonlyArray<EnvironmentAutomation> => {
      const next = get(environmentAutomationsAtom(ref.environmentId)).filter(
        (automation) => automation.projectId === ref.projectId,
      );
      if (arrayElementsEqual(previous, next)) {
        return previous;
      }
      previous = next.length === 0 ? EMPTY_ENVIRONMENT_AUTOMATIONS : next;
      return previous;
    }).pipe(Atom.withLabel(`environment-automations-for-project:${key}`));
  });

  let previousAutomations: ReadonlyArray<EnvironmentAutomation> = EMPTY_ENVIRONMENT_AUTOMATIONS;
  const automationsAtom = Atom.make((get): ReadonlyArray<EnvironmentAutomation> => {
    const next: EnvironmentAutomation[] = [];
    for (const environmentId of get(input.catalogValueAtom).entries.keys()) {
      next.push(...get(environmentAutomationsAtom(environmentId)));
    }
    if (arrayElementsEqual(previousAutomations, next)) {
      return previousAutomations;
    }
    previousAutomations = next;
    return previousAutomations;
  }).pipe(Atom.withLabel("environment-automation-list"));

  const automationShellAtom = (ref: ScopedAutomationRef) =>
    automationShellAtomFamily(automationKey(ref));

  const scheduler = createAtomCommandScheduler();
  // Automation writes are order-sensitive against the read model the decider
  // reads (a rename followed by a run request), so they queue per environment.
  const concurrency = {
    mode: "serial" as const,
    key: ({ environmentId }: { readonly environmentId: string }) => environmentId,
  };

  return {
    environmentAutomationsAtom,
    automationIndexAtom,
    automationShellAtom,
    automationsAtom,
    automationsForProjectAtom: (ref: ScopedProjectRef) =>
      automationsForProjectAtomFamily(projectKey(ref)),
    /**
     * One page of run rows. The automation row is the first page's refresh
     * trigger: it changes when a run starts, finishes, or is skipped, and
     * never while a run streams output. Cursor pages are history strictly
     * before a run; callers chain their cursor off the live first page, so a
     * new run re-keys them instead of refetching every page.
     */
    listRuns: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:automations:list-runs",
      tag: WS_METHODS.automationsListRuns,
      staleTimeMs: 15_000,
      refreshTrigger: ({ environmentId, input: target }) =>
        target.beforeCursor === undefined
          ? automationShellAtom({ environmentId, automationId: target.automationId })
          : undefined,
    }),
    getRun: createEnvironmentRpcQueryAtomFamily(runtime, {
      label: "environment-data:automations:get-run",
      tag: WS_METHODS.automationsGetRun,
      staleTimeMs: 15_000,
    }),
    create: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:automation:create",
      execute: (commandInput: CreateAutomationInput) => createAutomation(commandInput),
      scheduler,
      concurrency,
    }),
    update: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:automation:update",
      execute: (commandInput: UpdateAutomationInput) => updateAutomation(commandInput),
      scheduler,
      concurrency,
    }),
    delete: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:automation:delete",
      execute: (commandInput: DeleteAutomationInput) => deleteAutomation(commandInput),
      scheduler,
      concurrency,
    }),
    runNow: createEnvironmentCommand(runtime, {
      label: "environment-data:commands:automation:run-now",
      execute: (commandInput: RunAutomationNowInput) => runAutomationNow(commandInput),
      scheduler,
      concurrency,
    }),
  };
}

export type AutomationEnvironmentAtoms = ReturnType<typeof createAutomationEnvironmentAtoms>;
