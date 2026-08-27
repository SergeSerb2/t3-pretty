import {
  ProviderDriverKind,
  PROVIDER_MODEL_ID_MAX_LENGTH,
  PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH,
  PROVIDER_OPTION_ID_MAX_LENGTH,
  PROVIDER_OPTION_LABEL_MAX_LENGTH,
  PROVIDER_OPTION_MAX_COUNT,
  PROVIDER_OPTION_VALUE_MAX_LENGTH,
  SERVER_PROVIDER_LABEL_MAX_LENGTH,
  SERVER_PROVIDER_MODELS_MAX_ITEMS,
  SERVER_PROVIDER_PATH_MAX_LENGTH,
  SERVER_PROVIDER_SLASH_COMMANDS_MAX_ITEMS,
  SERVER_PROVIDER_TEXT_MAX_LENGTH,
  SKILL_DESCRIPTION_MAX_LENGTH,
  SKILL_NAME_MAX_LENGTH,
  SKILL_STATE_MAX_ITEMS,
  type ModelCapabilities,
  type ServerProvider,
  type ServerProviderAuth,
  type ServerProviderSkill,
  type ServerProviderSlashCommand,
  type ServerProviderModel,
  type ServerProviderState,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { normalizeCustomModelSlug } from "@t3tools/shared/model";
import { isWindowsCommandNotFound } from "../processRunner.ts";
import { createProviderVersionAdvisory } from "./providerMaintenance.ts";
import { collectUint8StreamText } from "../stream/collectUint8StreamText.ts";

export const DEFAULT_TIMEOUT_MS = 4_000;
// Auth status checks involve disk/network lookups and can be slow on first run (especially Windows)
export const AUTH_PROBE_TIMEOUT_MS = 10_000;
export const PROVIDER_PROBE_OUTPUT_MAX_BYTES = 1024 * 1024;
const AUTH_BOOLEAN_SEARCH_MAX_NODES = 4_096;
export const NATIVE_RESUME_SLASH_COMMAND = {
  name: "resume",
  description: "Resume a native provider session in a new T3 thread",
  input: { hint: "Native session ID" },
} satisfies ServerProviderSlashCommand;

export interface CommandResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

export class ProviderCommandNotFoundError extends Schema.TaggedErrorClass<ProviderCommandNotFoundError>()(
  "ProviderCommandNotFoundError",
  {
    binaryPath: Schema.String,
    exitCode: Schema.Number,
    stdoutLength: Schema.Number,
    stderrLength: Schema.Number,
  },
) {
  override get message(): string {
    return `Provider command ${this.binaryPath} was not found (exit code ${this.exitCode}).`;
  }
}

const isProviderCommandNotFoundError = Schema.is(ProviderCommandNotFoundError);

export interface ProviderProbeResult {
  readonly installed: boolean;
  readonly version: string | null;
  readonly status: Exclude<ServerProviderState, "disabled">;
  readonly auth: ServerProviderAuth;
  readonly message?: string;
}

export interface ServerProviderPresentation {
  readonly displayName: string;
  readonly badgeLabel?: string;
  readonly showInteractionModeToggle?: boolean;
  readonly requiresNewThreadForModelChange?: boolean;
  readonly supportsNativeResume?: boolean;
}

export type ServerProviderDraft = Omit<ServerProvider, "instanceId" | "driver">;

export function nonEmptyTrimmed(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const boundedText = (value: string, maximumLength: number): string => value.slice(0, maximumLength);

const boundedOptionalText = (
  value: string | undefined,
  maximumLength: number,
): string | undefined => (value === undefined ? undefined : boundedText(value, maximumLength));

function boundedProviderModel(model: ServerProviderModel): ServerProviderModel {
  return {
    ...model,
    slug: boundedText(model.slug, PROVIDER_MODEL_ID_MAX_LENGTH),
    name: boundedText(model.name, SERVER_PROVIDER_LABEL_MAX_LENGTH),
    ...(model.shortName === undefined
      ? {}
      : { shortName: boundedText(model.shortName, SERVER_PROVIDER_LABEL_MAX_LENGTH) }),
    ...(model.subProvider === undefined
      ? {}
      : { subProvider: boundedText(model.subProvider, SERVER_PROVIDER_LABEL_MAX_LENGTH) }),
  };
}

function boundedProviderSlashCommand(
  command: ServerProviderSlashCommand,
): ServerProviderSlashCommand {
  return {
    name: boundedText(command.name, SERVER_PROVIDER_LABEL_MAX_LENGTH),
    ...(command.description === undefined
      ? {}
      : { description: boundedText(command.description, SERVER_PROVIDER_TEXT_MAX_LENGTH) }),
    ...(command.input === undefined
      ? {}
      : {
          input: {
            hint: boundedText(command.input.hint, SERVER_PROVIDER_TEXT_MAX_LENGTH),
          },
        }),
  };
}

function boundedProviderSkill(skill: ServerProviderSkill): ServerProviderSkill {
  return {
    ...skill,
    name: boundedText(skill.name, SKILL_NAME_MAX_LENGTH),
    path: boundedText(skill.path, SERVER_PROVIDER_PATH_MAX_LENGTH),
    ...(skill.description === undefined
      ? {}
      : { description: boundedText(skill.description, SKILL_DESCRIPTION_MAX_LENGTH) }),
    ...(skill.scope === undefined
      ? {}
      : { scope: boundedText(skill.scope, SERVER_PROVIDER_LABEL_MAX_LENGTH) }),
    ...(skill.displayName === undefined
      ? {}
      : { displayName: boundedText(skill.displayName, SERVER_PROVIDER_LABEL_MAX_LENGTH) }),
    ...(skill.shortDescription === undefined
      ? {}
      : {
          shortDescription: boundedText(skill.shortDescription, SERVER_PROVIDER_TEXT_MAX_LENGTH),
        }),
  };
}

export function isCommandMissingCause(error: unknown): boolean {
  if (isProviderCommandNotFoundError(error)) return true;
  return error instanceof PlatformError.PlatformError && error.reason._tag === "NotFound";
}

export const spawnAndCollect = (binaryPath: string, command: ChildProcess.Command) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(command);
    const [stdout, stderr, exitCode] = yield* Effect.all(
      [
        collectStreamAsString(child.stdout),
        collectStreamAsString(child.stderr),
        child.exitCode.pipe(Effect.map(Number)),
      ],
      { concurrency: "unbounded" },
    );

    const result: CommandResult = { stdout, stderr, code: exitCode };
    if (yield* isWindowsCommandNotFound(exitCode, stderr)) {
      return yield* new ProviderCommandNotFoundError({
        binaryPath,
        exitCode,
        stdoutLength: stdout.length,
        stderrLength: stderr.length,
      });
    }
    return result;
  }).pipe(Effect.scoped);

export function detailFromResult(
  result: CommandResult & { readonly timedOut?: boolean },
): string | undefined {
  if (result.timedOut) return "Timed out while running command.";
  const stderr = nonEmptyTrimmed(result.stderr);
  if (stderr) return stderr;
  const stdout = nonEmptyTrimmed(result.stdout);
  if (stdout) return stdout;
  if (result.code !== 0) {
    return `Command exited with code ${result.code}.`;
  }
  return undefined;
}

export function extractAuthBoolean(value: unknown): boolean | undefined {
  const pending: unknown[] = [value];
  const seen = new WeakSet<object>();
  let visited = 0;

  while (pending.length > 0 && visited < AUTH_BOOLEAN_SEARCH_MAX_NODES) {
    const current = pending.pop();
    visited += 1;
    if (!current || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);

    if (globalThis.Array.isArray(current)) {
      const remainingBudget = Math.max(0, AUTH_BOOLEAN_SEARCH_MAX_NODES - visited - pending.length);
      for (let index = Math.min(current.length, remainingBudget) - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
      }
      continue;
    }

    const record = current as Record<string, unknown>;
    for (const key of ["authenticated", "isAuthenticated", "loggedIn", "isLoggedIn"] as const) {
      if (typeof record[key] === "boolean") return record[key];
    }
    for (const key of ["account", "session", "status", "auth"] as const) {
      pending.push(record[key]);
    }
  }
  return undefined;
}

export function parseGenericCliVersion(output: string): string | null {
  const match = output.match(/\b(\d+\.\d+\.\d+)\b/);
  return match?.[1] ?? null;
}

export function providerModelsFromSettings(
  builtInModels: ReadonlyArray<ServerProviderModel>,
  customModels: ReadonlyArray<string>,
  customModelCapabilities: ModelCapabilities,
): ReadonlyArray<ServerProviderModel> {
  const resolvedBuiltInModels = [...builtInModels];
  const seen = new Set(resolvedBuiltInModels.map((model) => model.slug));
  const customEntries: ServerProviderModel[] = [];

  for (const candidate of customModels) {
    const normalized = normalizeCustomModelSlug(candidate);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    customEntries.push({
      slug: normalized,
      name: normalized,
      isCustom: true,
      capabilities: customModelCapabilities,
    });
  }

  return [...resolvedBuiltInModels, ...customEntries];
}

export function buildSelectOptionDescriptor(input: {
  readonly id: string;
  readonly label: string;
  readonly options:
    | ReadonlyArray<{
        value: string;
        label: string;
        description?: string | undefined;
        isDefault?: boolean | undefined;
      }>
    | undefined;
  readonly description?: string;
  readonly promptInjectedValues?: ReadonlyArray<string>;
}) {
  const options = (input.options ?? []).slice(0, PROVIDER_OPTION_MAX_COUNT).map((option) => ({
    id: boundedText(option.value, PROVIDER_OPTION_ID_MAX_LENGTH),
    label: boundedText(option.label, PROVIDER_OPTION_LABEL_MAX_LENGTH),
    ...(option.description
      ? {
          description: boundedText(option.description, PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH),
        }
      : {}),
    ...(option.isDefault ? { isDefault: true } : {}),
  }));
  const currentValue = options.find((option) => option.isDefault)?.id;
  return {
    id: boundedText(input.id, PROVIDER_OPTION_ID_MAX_LENGTH),
    label: boundedText(input.label, PROVIDER_OPTION_LABEL_MAX_LENGTH),
    type: "select" as const,
    options,
    ...(currentValue
      ? { currentValue: boundedText(currentValue, PROVIDER_OPTION_VALUE_MAX_LENGTH) }
      : {}),
    ...(input.description
      ? { description: boundedText(input.description, PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH) }
      : {}),
    ...(input.promptInjectedValues && input.promptInjectedValues.length > 0
      ? {
          promptInjectedValues: input.promptInjectedValues
            .slice(0, PROVIDER_OPTION_MAX_COUNT)
            .map((value) => boundedText(value, PROVIDER_OPTION_VALUE_MAX_LENGTH)),
        }
      : {}),
  };
}

export function buildBooleanOptionDescriptor(input: {
  readonly id: string;
  readonly label: string;
  readonly currentValue?: boolean;
  readonly description?: string;
}) {
  return {
    id: boundedText(input.id, PROVIDER_OPTION_ID_MAX_LENGTH),
    label: boundedText(input.label, PROVIDER_OPTION_LABEL_MAX_LENGTH),
    type: "boolean" as const,
    ...(input.description
      ? { description: boundedText(input.description, PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH) }
      : {}),
    ...(typeof input.currentValue === "boolean" ? { currentValue: input.currentValue } : {}),
  };
}

export function buildServerProvider(input: {
  driver?: ProviderDriverKind;
  presentation: ServerProviderPresentation;
  enabled: boolean;
  checkedAt: string;
  models: ReadonlyArray<ServerProviderModel>;
  slashCommands?: ReadonlyArray<ServerProviderSlashCommand>;
  skills?: ReadonlyArray<ServerProviderSkill>;
  probe: ProviderProbeResult;
}): ServerProviderDraft {
  const slashCommands =
    input.presentation.supportsNativeResume &&
    input.probe.installed &&
    input.probe.status !== "error"
      ? [
          NATIVE_RESUME_SLASH_COMMAND,
          ...(input.slashCommands ?? []).filter(
            (command) => command.name !== NATIVE_RESUME_SLASH_COMMAND.name,
          ),
        ]
      : (input.slashCommands ?? []);
  const version =
    input.probe.version === null
      ? null
      : boundedText(input.probe.version, SERVER_PROVIDER_LABEL_MAX_LENGTH);
  const authType = boundedOptionalText(input.probe.auth.type, SERVER_PROVIDER_LABEL_MAX_LENGTH);
  const authLabel = boundedOptionalText(input.probe.auth.label, SERVER_PROVIDER_LABEL_MAX_LENGTH);
  const authEmail = boundedOptionalText(input.probe.auth.email, SERVER_PROVIDER_LABEL_MAX_LENGTH);
  const versionAdvisory = input.driver
    ? createProviderVersionAdvisory({
        driver: input.driver,
        currentVersion: version,
        checkedAt: input.checkedAt,
      })
    : undefined;
  return {
    displayName: boundedText(input.presentation.displayName, SERVER_PROVIDER_LABEL_MAX_LENGTH),
    ...(input.presentation.badgeLabel
      ? {
          badgeLabel: boundedText(input.presentation.badgeLabel, SERVER_PROVIDER_LABEL_MAX_LENGTH),
        }
      : {}),
    ...(typeof input.presentation.showInteractionModeToggle === "boolean"
      ? { showInteractionModeToggle: input.presentation.showInteractionModeToggle }
      : {}),
    ...(typeof input.presentation.requiresNewThreadForModelChange === "boolean"
      ? { requiresNewThreadForModelChange: input.presentation.requiresNewThreadForModelChange }
      : {}),
    enabled: input.enabled,
    installed: input.probe.installed,
    version,
    status: input.enabled ? input.probe.status : "disabled",
    auth: {
      status: input.probe.auth.status,
      ...(authType === undefined ? {} : { type: authType }),
      ...(authLabel === undefined ? {} : { label: authLabel }),
      ...(authEmail === undefined ? {} : { email: authEmail }),
    },
    checkedAt: input.checkedAt,
    ...(input.probe.message
      ? { message: boundedText(input.probe.message, SERVER_PROVIDER_TEXT_MAX_LENGTH) }
      : {}),
    models: input.models.slice(0, SERVER_PROVIDER_MODELS_MAX_ITEMS).map(boundedProviderModel),
    slashCommands: slashCommands
      .slice(0, SERVER_PROVIDER_SLASH_COMMANDS_MAX_ITEMS)
      .map(boundedProviderSlashCommand),
    skills: (input.skills ?? []).slice(0, SKILL_STATE_MAX_ITEMS).map(boundedProviderSkill),
    ...(versionAdvisory ? { versionAdvisory } : {}),
  };
}

export const collectStreamAsString = <E>(
  stream: Stream.Stream<Uint8Array, E>,
  options?: { readonly maxBytes?: number | undefined },
): Effect.Effect<string, E> =>
  collectUint8StreamText({
    stream,
    maxBytes: Math.min(
      options?.maxBytes ?? PROVIDER_PROBE_OUTPUT_MAX_BYTES,
      PROVIDER_PROBE_OUTPUT_MAX_BYTES,
    ),
  }).pipe(Effect.map((collected) => collected.text));
