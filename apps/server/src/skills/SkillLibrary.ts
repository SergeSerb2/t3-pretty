/**
 * SkillLibrary — the skill folders on the environment host, as one inventory.
 *
 * Provider CLIs discover skills from their own user-scope `skills/` folder
 * (`~/.claude/skills`, `~/.cursor/skills`, …); Codex and Cursor also read the
 * shared `~/.agents/skills` library. T3 Code keeps no store of its own: the
 * shared library is the store, and a skill reaches a CLI that does not read
 * it through a symlink in that CLI's folder — the layout `npx skills` writes,
 * so both installers see each other's work.
 *
 * This service scans every location, folds links onto the real folder they
 * point at, and reports one skill per folder with the locations it is present
 * in. Enabling a skill for a provider adds the link; disabling removes it;
 * nothing inside a skill folder is ever renamed or rewritten. Marketplace
 * installs land in the shared library and link into every provider that needs
 * a link. Per-thread picks resolve here to the `SKILL.md` bodies a turn
 * carries. Clients address skills by the opaque ids minted here; a
 * client-supplied path never crosses the wire inbound.
 *
 * On startup the service moves a pre-library T3 store
 * (`<state>/skills/<owner>--<repo>/…`) into the shared library, drops copies
 * of skills already there, and deletes the empty store.
 *
 * @module skills/SkillLibrary
 */
// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";

import {
  ProviderDriverKind,
  ProviderInstanceId,
  SkillsError,
  SKILL_DOCUMENT_MAX_BYTES,
  SKILL_FRONTMATTER_READ_MAX_BYTES,
  SKILL_STATE_MAX_ITEMS,
  type Skill,
  type SkillId,
  type SkillLocation,
  type SkillSource,
  type SkillsState,
} from "@t3tools/contracts";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import { fromJsonStringPretty, fromLenientJson } from "@t3tools/shared/schemaJson";
import { parseSkillFrontmatter, SKILL_FRONTMATTER_PATTERN } from "@t3tools/shared/skillFrontmatter";
import { normalizeSkillId } from "@t3tools/shared/skillTool";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import { readTextPrefix, readTextWithinLimit } from "../boundedFileRead.ts";
import * as ServerConfig from "../config.ts";
import { expandHomePath } from "../pathExpansion.ts";
import { ServerSettingsService } from "../serverSettings.ts";

const SKILL_ID_PREFIX = "host:";
/** Key of the shared library location; every other key is a provider driver. */
export const SHARED_LOCATION_KEY = "agents";
const SKILL_FILE = "SKILL.md";
/** Older T3 servers hid a skill from its CLI by renaming its document to this. */
const LEGACY_DISABLED_SKILL_FILE = "SKILL.md.t3-disabled";
/** Marker older T3 servers wrote into workspace copies of skills. */
export const LEGACY_MANAGED_MARKER_FILE = ".t3-managed";
/** Install metadata kept inside a skill folder T3 installed. */
export const SKILL_METADATA_FILE = ".t3-skill.json";
const SKILL_METADATA_MAX_BYTES = 16 * 1024;
/** Legacy store skills sit at most this deep below their repo dir. */
const LEGACY_STORE_SCAN_MAX_DEPTH = 8;
/** Workspace roots older T3 servers copied skills into. */
const WORKSPACE_SKILL_ROOTS = [
  [".claude", "skills"],
  [".agents", "skills"],
] as const;

/** Home directory the locations hang off; tests point it at a temp dir. */
export const SkillLibraryHomeDirectory = Context.Reference<string>(
  "t3/skills/SkillLibraryHomeDirectory",
  { defaultValue: () => NodeOS.homedir() },
);

const SkillMetadata = Schema.Struct({
  installedAt: Schema.String,
  source: Schema.optional(Schema.Struct({ repo: Schema.String, path: Schema.String })),
});
const decodeSkillMetadata = Schema.decodeUnknownEffect(fromLenientJson(SkillMetadata));
const encodeSkillMetadata = Schema.encodeEffect(fromJsonStringPretty(SkillMetadata));

type DriverKey = "claudeAgent" | "codex" | "cursor" | "grok";

const DRIVER_CONVENTIONS: ReadonlyArray<{
  readonly key: DriverKey;
  readonly title: string;
  readonly defaultHome: (home: string, environment: NodeJS.ProcessEnv) => string;
  /** Other locations this CLI scans natively (verified per driver, see the discovery modules). */
  readonly alsoReads: ReadonlyArray<string>;
}> = [
  {
    key: "claudeAgent",
    title: "Claude Code",
    defaultHome: (home, environment) => {
      const configDir = environment.CLAUDE_CONFIG_DIR?.trim() ?? "";
      return configDir.length > 0 ? configDir : `${home}/.claude`;
    },
    alsoReads: [],
  },
  {
    key: "codex",
    title: "Codex",
    defaultHome: (home) => `${home}/.codex`,
    alsoReads: [SHARED_LOCATION_KEY],
  },
  {
    key: "cursor",
    title: "Cursor",
    defaultHome: (home) => `${home}/.cursor`,
    alsoReads: [SHARED_LOCATION_KEY, "codex", "claudeAgent"],
  },
  {
    key: "grok",
    title: "Grok",
    defaultHome: (home) => `${home}/.grok`,
    alsoReads: [],
  },
];
const DRIVER_KEYS = new Set<string>(DRIVER_CONVENTIONS.map((convention) => convention.key));

interface Location {
  readonly key: string;
  readonly title: string;
  readonly directory: string;
  readonly driver?: ProviderDriverKind;
  readonly instanceId?: ProviderInstanceId;
  readonly reads: ReadonlyArray<string>;
}

/**
 * One filesystem-safe path segment: no separators, no traversal, no leading
 * dot (dot-directories are skipped by the scan, so they cannot round-trip),
 * no colon (the id separator).
 */
export function isSafeSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment !== "." &&
    segment !== ".." &&
    !segment.startsWith(".") &&
    !segment.includes("/") &&
    !segment.includes("\\") &&
    !segment.includes("\0") &&
    !segment.includes(":")
  );
}

export interface ParsedSkillId {
  readonly locationKey: string;
  readonly dirName: string;
}

/** `host:<location key>:<dir>`; the key itself may carry one `:` for an instance. */
export function parseSkillId(skillId: string): ParsedSkillId | null {
  if (!skillId.startsWith(SKILL_ID_PREFIX)) {
    return null;
  }
  const parts = skillId.slice(SKILL_ID_PREFIX.length).split(":");
  const dirName = parts[parts.length - 1];
  if (dirName === undefined || !isSafeSegment(dirName)) {
    return null;
  }
  if (parts.length === 2) {
    const [originKey] = parts;
    return originKey && (DRIVER_KEYS.has(originKey) || originKey === SHARED_LOCATION_KEY)
      ? { locationKey: originKey, dirName }
      : null;
  }
  if (parts.length === 3) {
    const [originKey, instanceKey] = parts;
    return originKey && instanceKey && DRIVER_KEYS.has(originKey) && isSafeSegment(instanceKey)
      ? { locationKey: `${originKey}:${instanceKey}`, dirName }
      : null;
  }
  return null;
}

export function formatSkillId(locationKey: string, dirName: string): string {
  return `${SKILL_ID_PREFIX}${locationKey}:${dirName}`;
}

/** `SKILL.md` with its YAML frontmatter removed; the frontmatter is metadata for pickers, not instructions. */
export function skillBodyFromDocument(contents: string): string {
  return contents.replace(SKILL_FRONTMATTER_PATTERN, "").trim();
}

/** Directory-safe, lowercase form of a skill name; what a `$mention` folds to. */
export function sanitizeSkillDirectoryName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");
}

/** Case-insensitive match on a skill's name or its directory-safe form. */
export function skillNameMatches(candidate: string, mention: string): boolean {
  return (
    candidate.trim().toLowerCase() === mention.trim().toLowerCase() ||
    sanitizeSkillDirectoryName(candidate) === sanitizeSkillDirectoryName(mention)
  );
}

/** A skill document ready to be sent with a turn. */
export interface SkillDocument {
  readonly name: string;
  /** Absolute real directory holding `SKILL.md`; relative paths in the body resolve against it. */
  readonly directory: string;
  readonly body: string;
}

export class SkillLibrary extends Context.Service<
  SkillLibrary,
  {
    readonly getState: Effect.Effect<SkillsState, SkillsError>;
    /**
     * Copy a folder holding a `SKILL.md` into the shared library as
     * `dirName` and link it into every provider location that does not read
     * the library. Replaces an earlier install of the same source; refuses a
     * name another skill already holds.
     */
    readonly installFromDirectory: (input: {
      readonly dirName: string;
      readonly directory: string;
      readonly source: SkillSource;
    }) => Effect.Effect<SkillsState, SkillsError>;
    /** Delete the skill's real folder and every link to it. */
    readonly uninstall: (skillId: SkillId) => Effect.Effect<SkillsState, SkillsError>;
    /** Add or remove the link for one provider location. */
    readonly setLocationEnabled: (input: {
      readonly skillId: SkillId;
      readonly locationKey: string;
      readonly enabled: boolean;
    }) => Effect.Effect<SkillsState, SkillsError>;
    /**
     * Documents for per-thread picks, in input order. Unknown ids are
     * dropped; pre-library ids fold onto the library. Never fails.
     */
    readonly resolveDocuments: (
      skillIds: ReadonlyArray<SkillId>,
    ) => Effect.Effect<ReadonlyArray<SkillDocument & { readonly id: SkillId }>>;
    /**
     * Resolve `$skill` mentions to documents: the workspace roots under
     * `cwd` first, then `candidates` (the provider snapshot's skills, name +
     * `SKILL.md` path). Unresolvable names are dropped. Never fails.
     */
    readonly resolveMentions: (input: {
      readonly cwd: string | undefined;
      readonly names: ReadonlyArray<string>;
      readonly candidates: ReadonlyArray<{ readonly name: string; readonly path: string }>;
    }) => Effect.Effect<ReadonlyArray<SkillDocument>>;
    /**
     * Delete the workspace copies an older T3 server wrote under
     * `<cwd>/.claude/skills` and `<cwd>/.agents/skills`. Only folders carrying
     * the `.t3-managed` marker are touched. Never fails.
     */
    readonly removeManagedWorkspaceCopies: (cwd: string) => Effect.Effect<void>;
  }
>()("t3/skills/SkillLibrary") {}

function isNotSymlinkError(error: PlatformError.PlatformError): boolean {
  const cause = error.reason.cause;
  return (
    error.reason._tag === "Unknown" &&
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    (cause.code === "EINVAL" || cause.code === "UNKNOWN")
  );
}

type EntryState =
  | { readonly _tag: "missing" }
  | { readonly _tag: "link" }
  | { readonly _tag: "real" };

export const make = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const serverSettings = yield* ServerSettingsService;
  const platform = yield* HostProcessPlatform;
  const environment = yield* HostProcessEnvironment;
  const home = path.resolve(yield* SkillLibraryHomeDirectory);

  const abbreviateHome = (absolutePath: string): string =>
    absolutePath === home || absolutePath.startsWith(`${home}${path.sep}`)
      ? `~${absolutePath.slice(home.length)}`
      : absolutePath;

  const skillsError = (
    operation: SkillsError["operation"],
    message: string,
    extra?: { readonly skillId?: string; readonly cause?: unknown },
  ) =>
    new SkillsError({
      operation,
      message,
      ...(extra?.skillId !== undefined ? { skillId: extra.skillId } : {}),
      ...(extra?.cause !== undefined ? { cause: extra.cause } : {}),
    });

  const entryState = (entryPath: string): Effect.Effect<EntryState> =>
    fileSystem.readLink(entryPath).pipe(
      Effect.map((): EntryState => ({ _tag: "link" })),
      Effect.catch((error) =>
        Effect.succeed<EntryState>(
          error.reason._tag === "NotFound"
            ? { _tag: "missing" }
            : isNotSymlinkError(error)
              ? { _tag: "real" }
              : { _tag: "missing" },
        ),
      ),
    );

  const isDirectory = (target: string) =>
    fileSystem.stat(target).pipe(
      Effect.map((info) => info.type === "Directory"),
      Effect.orElseSucceed(() => false),
    );

  const exists = (target: string) =>
    fileSystem.exists(target).pipe(Effect.orElseSucceed(() => false));

  const collectLocations = Effect.fn("SkillLibrary.collectLocations")(function* (
    operation: SkillsError["operation"],
  ) {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError((cause) =>
        skillsError(operation, "Failed to read server settings while listing skills.", { cause }),
      ),
    );
    const locations: Array<Location> = [];
    const seenDirectories = new Set<string>();
    const add = (location: Location) => {
      if (seenDirectories.has(location.directory)) {
        return;
      }
      seenDirectories.add(location.directory);
      locations.push(location);
    };

    add({
      key: SHARED_LOCATION_KEY,
      title: "Shared",
      directory: path.join(home, ".agents", "skills"),
      reads: [SHARED_LOCATION_KEY],
    });
    for (const convention of DRIVER_CONVENTIONS) {
      const driver = ProviderDriverKind.make(convention.key);
      add({
        key: convention.key,
        title: convention.title,
        // No tilde expansion: an env-provided config dir reaches the CLI
        // verbatim, so this must scan the same directory the CLI would.
        directory: path.join(path.resolve(convention.defaultHome(home, environment)), "skills"),
        driver,
        reads: [convention.key, ...convention.alsoReads],
      });
      for (const [instanceId, instance] of Object.entries(settings.providerInstances)) {
        if (instance.driver !== convention.key || !isSafeSegment(instanceId)) {
          continue;
        }
        const configured =
          typeof instance.config === "object" && instance.config !== null
            ? (instance.config as Record<string, unknown>).homePath
            : undefined;
        const homePath = typeof configured === "string" ? configured.trim() : "";
        if (homePath.length === 0) {
          continue;
        }
        const displayName = instance.displayName?.trim();
        const key = `${convention.key}:${instanceId}`;
        add({
          key,
          title: displayName ? `${convention.title} · ${displayName}` : convention.title,
          directory: path.join(path.resolve(expandHomePath(homePath)), "skills"),
          driver,
          instanceId: ProviderInstanceId.make(instanceId),
          reads: [key, ...convention.alsoReads],
        });
      }
    }
    return locations;
  });

  /**
   * Older servers hid a skill by renaming its document; a folder found in
   * that state comes back as a normal skill. Returns whether a SKILL.md is now
   * present.
   */
  const ensureSkillDocument = Effect.fn("SkillLibrary.ensureSkillDocument")(function* (
    skillDir: string,
  ) {
    const documentPath = path.join(skillDir, SKILL_FILE);
    if (yield* exists(documentPath)) {
      return true;
    }
    const disabledPath = path.join(skillDir, LEGACY_DISABLED_SKILL_FILE);
    if (!(yield* exists(disabledPath))) {
      return false;
    }
    return yield* fileSystem.rename(disabledPath, documentPath).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
  });

  const readMetadata = (skillDir: string) =>
    readTextPrefix(
      fileSystem,
      path.join(skillDir, SKILL_METADATA_FILE),
      SKILL_METADATA_MAX_BYTES,
    ).pipe(
      Effect.flatMap((contents) => decodeSkillMetadata(contents)),
      Effect.option,
    );

  const readFrontmatter = (skillDir: string) =>
    readTextPrefix(
      fileSystem,
      path.join(skillDir, SKILL_FILE),
      SKILL_FRONTMATTER_READ_MAX_BYTES,
    ).pipe(
      Effect.map(parseSkillFrontmatter),
      Effect.orElseSucceed(() => parseSkillFrontmatter("")),
    );

  const getState: Effect.Effect<SkillsState, SkillsError> = Effect.gen(function* () {
    const locations = yield* collectLocations("list");
    // One record per real folder; links fold onto the folder they point at.
    const byRealPath = new Map<
      string,
      {
        home: { location: Location; dirName: string } | undefined;
        firstSeen: { location: Location; dirName: string };
        presentIn: Set<string>;
      }
    >();
    for (const location of locations) {
      const entries = yield* fileSystem
        .readDirectory(location.directory)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      for (const entry of [...entries].sort()) {
        if (!isSafeSegment(entry)) {
          continue;
        }
        const entryPath = path.join(location.directory, entry);
        if (!(yield* isDirectory(entryPath))) {
          continue;
        }
        if (!(yield* ensureSkillDocument(entryPath))) {
          continue;
        }
        const state = yield* entryState(entryPath);
        const realPath = yield* fileSystem
          .realPath(entryPath)
          .pipe(Effect.orElseSucceed(() => entryPath));
        const record = byRealPath.get(realPath) ?? {
          home: undefined,
          firstSeen: { location, dirName: entry },
          presentIn: new Set<string>(),
        };
        record.presentIn.add(location.key);
        if (state._tag === "real" && record.home === undefined) {
          record.home = { location, dirName: entry };
        }
        byRealPath.set(realPath, record);
      }
    }

    const order = new Map(locations.map((location, index) => [location.key, index] as const));
    const skills: Array<Skill> = [];
    for (const [realPath, record] of byRealPath) {
      if (skills.length >= SKILL_STATE_MAX_ITEMS) {
        break;
      }
      // A skill whose every entry is a link (its folder lives outside any
      // location) is addressed through the first location that has it.
      const homeEntry = record.home ?? record.firstSeen;
      const frontmatter = yield* readFrontmatter(realPath);
      const metadata = yield* readMetadata(realPath);
      skills.push({
        id: formatSkillId(homeEntry.location.key, homeEntry.dirName),
        name:
          frontmatter.kind === "parsed" && frontmatter.name ? frontmatter.name : homeEntry.dirName,
        dirName: homeEntry.dirName,
        ...(frontmatter.kind === "parsed" && frontmatter.description
          ? { description: frontmatter.description }
          : {}),
        displayPath: abbreviateHome(path.join(homeEntry.location.directory, homeEntry.dirName)),
        home: homeEntry.location.key,
        presentIn: [...record.presentIn].sort(
          (left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0),
        ),
        ...(metadata._tag === "Some" && metadata.value.source
          ? { source: metadata.value.source }
          : {}),
        ...(metadata._tag === "Some" ? { installedAt: metadata.value.installedAt } : {}),
      });
    }
    skills.sort(
      (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
    );
    return {
      locations: locations.map((location): SkillLocation => ({
        key: location.key,
        title: location.title,
        displayPath: abbreviateHome(location.directory),
        ...(location.driver ? { driver: location.driver } : {}),
        ...(location.instanceId ? { instanceId: location.instanceId } : {}),
        reads: location.reads,
      })),
      skills,
    } satisfies SkillsState;
  });

  /** The real folder behind a skill id, checked to hold a skill document. */
  const resolveSkill = Effect.fn("SkillLibrary.resolveSkill")(function* (
    operation: SkillsError["operation"],
    skillId: string,
    locations: ReadonlyArray<Location>,
  ) {
    const parsed = parseSkillId(skillId);
    const location = parsed
      ? locations.find((candidate) => candidate.key === parsed.locationKey)
      : undefined;
    if (!parsed || !location) {
      return yield* skillsError(operation, `Unknown skill: ${skillId}.`, { skillId });
    }
    const entryPath = path.resolve(location.directory, parsed.dirName);
    if (path.relative(location.directory, entryPath) !== parsed.dirName) {
      return yield* skillsError(operation, `Invalid skill id: ${skillId}.`, { skillId });
    }
    if (!(yield* isDirectory(entryPath)) || !(yield* ensureSkillDocument(entryPath))) {
      return yield* skillsError(operation, `Skill ${skillId} is not installed.`, { skillId });
    }
    const realPath = yield* fileSystem
      .realPath(entryPath)
      .pipe(Effect.orElseSucceed(() => entryPath));
    return { location, dirName: parsed.dirName, entryPath, realPath } as const;
  });

  /** Symlink `<location>/<dirName>` at the real folder, the way `npx skills` does. */
  const createLink = Effect.fn("SkillLibrary.createLink")(function* (
    operation: SkillsError["operation"],
    input: { readonly location: Location; readonly dirName: string; readonly realPath: string },
  ) {
    const linkPath = path.join(input.location.directory, input.dirName);
    yield* fileSystem.makeDirectory(input.location.directory, { recursive: true }).pipe(
      Effect.mapError((cause) =>
        skillsError(operation, `Failed to create ${abbreviateHome(input.location.directory)}.`, {
          cause,
        }),
      ),
    );
    // Relative links survive a moved home directory; Windows junctions must
    // be absolute and need no privilege, unlike directory symlinks.
    const linkDirectory = yield* fileSystem
      .realPath(input.location.directory)
      .pipe(Effect.orElseSucceed(() => input.location.directory));
    const target =
      platform === "win32" ? input.realPath : path.relative(linkDirectory, input.realPath);
    yield* Effect.tryPromise({
      try: () => NodeFSP.symlink(target, linkPath, platform === "win32" ? "junction" : undefined),
      catch: (cause) =>
        skillsError(operation, `Failed to link the skill into ${abbreviateHome(linkPath)}.`, {
          cause,
        }),
    });
  });

  const removeDanglingLinks = Effect.fn("SkillLibrary.removeDanglingLinks")(function* (
    locations: ReadonlyArray<Location>,
    dirName: string,
  ) {
    for (const location of locations) {
      const linkPath = path.join(location.directory, dirName);
      const state = yield* entryState(linkPath);
      if (state._tag !== "link") {
        continue;
      }
      const resolves = yield* fileSystem.realPath(linkPath).pipe(
        Effect.as(true),
        Effect.orElseSucceed(() => false),
      );
      if (!resolves) {
        yield* fileSystem.remove(linkPath).pipe(Effect.orElseSucceed(() => undefined));
      }
    }
  });

  /** Write the folder into the shared library and link it where a link is needed. */
  const placeInLibrary = Effect.fn("SkillLibrary.placeInLibrary")(function* (
    operation: SkillsError["operation"],
    locations: ReadonlyArray<Location>,
    input: { readonly dirName: string; readonly directory: string; readonly source: SkillSource },
  ) {
    const shared = locations.find((location) => location.key === SHARED_LOCATION_KEY)!;
    const target = path.join(shared.directory, input.dirName);
    const failed = (message: string) => (cause: unknown) =>
      skillsError(operation, message, { cause });
    if (yield* exists(target)) {
      const metadata = yield* readMetadata(target);
      const sameSource =
        metadata._tag === "Some" &&
        metadata.value.source?.repo === input.source.repo &&
        metadata.value.source.path === input.source.path;
      if (!sameSource) {
        return yield* skillsError(
          operation,
          `A skill named "${input.dirName}" is already in ${abbreviateHome(shared.directory)}. Remove it first to install this one.`,
        );
      }
      yield* fileSystem
        .remove(target, { recursive: true, force: true })
        .pipe(Effect.mapError(failed(`Failed to replace ${abbreviateHome(target)}.`)));
    }
    yield* fileSystem
      .makeDirectory(shared.directory, { recursive: true })
      .pipe(Effect.mapError(failed(`Failed to create ${abbreviateHome(shared.directory)}.`)));
    yield* fileSystem
      .copy(input.directory, target)
      .pipe(Effect.mapError(failed(`Failed to copy the skill into ${abbreviateHome(target)}.`)));
    const metadata = yield* encodeSkillMetadata({
      installedAt: DateTime.formatIso(yield* DateTime.now),
      source: input.source,
    }).pipe(Effect.mapError(failed("Failed to encode the skill metadata.")));
    yield* fileSystem
      .writeFileString(path.join(target, SKILL_METADATA_FILE), metadata)
      .pipe(Effect.mapError(failed("Failed to write the skill metadata.")));

    // Links are best-effort: a provider folder that refuses a link leaves the
    // skill available everywhere else, and the state shows where it landed.
    const realPath = yield* fileSystem.realPath(target).pipe(Effect.orElseSucceed(() => target));
    for (const location of locations) {
      if (location.key === SHARED_LOCATION_KEY || location.reads.includes(SHARED_LOCATION_KEY)) {
        continue;
      }
      const linkPath = path.join(location.directory, input.dirName);
      if ((yield* entryState(linkPath))._tag !== "missing") {
        continue;
      }
      yield* createLink(operation, { location, dirName: input.dirName, realPath }).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Skipping a skill link the provider folder refused", {
            skill: input.dirName,
            location: location.key,
            detail: error.message,
          }),
        ),
      );
    }
  });

  const installFromDirectory: SkillLibrary["Service"]["installFromDirectory"] = Effect.fn(
    "SkillLibrary.installFromDirectory",
  )(function* (input) {
    if (!isSafeSegment(input.dirName)) {
      return yield* skillsError("install", `Invalid skill folder name: ${input.dirName}.`);
    }
    if (!(yield* exists(path.join(input.directory, SKILL_FILE)))) {
      return yield* skillsError(
        "install",
        `Cannot install ${input.dirName}: the directory has no SKILL.md.`,
      );
    }
    const locations = yield* collectLocations("install");
    yield* placeInLibrary("install", locations, input);
    return yield* getState;
  });

  const uninstall: SkillLibrary["Service"]["uninstall"] = Effect.fn("SkillLibrary.uninstall")(
    function* (skillId) {
      const locations = yield* collectLocations("uninstall");
      const skill = yield* resolveSkill("uninstall", skillId, locations);
      const state = yield* entryState(skill.entryPath);
      // A home entry that is itself a link points outside every location:
      // dropping the link is the whole uninstall, the folder is not ours.
      yield* (
        state._tag === "link"
          ? fileSystem.remove(skill.entryPath)
          : fileSystem.remove(skill.realPath, { recursive: true, force: true })
      ).pipe(
        Effect.mapError((cause) =>
          skillsError("uninstall", `Failed to remove ${abbreviateHome(skill.entryPath)}.`, {
            skillId,
            cause,
          }),
        ),
      );
      yield* removeDanglingLinks(locations, skill.dirName);
      return yield* getState;
    },
  );

  const setLocationEnabled: SkillLibrary["Service"]["setLocationEnabled"] = Effect.fn(
    "SkillLibrary.setLocationEnabled",
  )(function* (input) {
    const locations = yield* collectLocations("set-location");
    const skill = yield* resolveSkill("set-location", input.skillId, locations);
    const location = locations.find((candidate) => candidate.key === input.locationKey);
    if (!location) {
      return yield* skillsError("set-location", `Unknown skill location: ${input.locationKey}.`, {
        skillId: input.skillId,
      });
    }
    const linkPath = path.join(location.directory, skill.dirName);
    const state = yield* entryState(linkPath);
    const failed = (message: string) => (cause: unknown) =>
      skillsError("set-location", message, { skillId: input.skillId, cause });

    if (location.key === skill.location.key) {
      if (input.enabled) {
        return yield* getState;
      }
      return yield* skillsError(
        "set-location",
        `${abbreviateHome(linkPath)} is where this skill lives. Remove the skill to take it out of ${location.title}.`,
        { skillId: input.skillId },
      );
    }
    if (input.enabled) {
      if (state._tag === "real") {
        return yield* skillsError(
          "set-location",
          `${location.title} already has its own "${skill.dirName}" folder.`,
          { skillId: input.skillId },
        );
      }
      if (state._tag === "link") {
        // Retarget: the existing link may point at a stale or different copy.
        yield* fileSystem
          .remove(linkPath)
          .pipe(Effect.mapError(failed(`Failed to replace ${abbreviateHome(linkPath)}.`)));
      }
      yield* createLink("set-location", {
        location,
        dirName: skill.dirName,
        realPath: skill.realPath,
      });
      return yield* getState;
    }
    if (state._tag === "real") {
      return yield* skillsError(
        "set-location",
        `${abbreviateHome(linkPath)} is a separate copy, not a link. Remove that skill instead.`,
        { skillId: input.skillId },
      );
    }
    if (state._tag === "link") {
      yield* fileSystem
        .remove(linkPath)
        .pipe(Effect.mapError(failed(`Failed to remove ${abbreviateHome(linkPath)}.`)));
    }
    return yield* getState;
  });

  /**
   * Read a skill document from either its directory or its `SKILL.md` path.
   * Returns undefined when nothing readable is there.
   */
  const readSkillDocument = Effect.fn("SkillLibrary.readSkillDocument")(function* (
    name: string | undefined,
    location: string,
  ): Effect.fn.Return<SkillDocument | undefined> {
    const info = yield* fileSystem.stat(location).pipe(Effect.orElseSucceed(() => undefined));
    if (!info) {
      return undefined;
    }
    const filePath = info.type === "Directory" ? path.join(location, SKILL_FILE) : location;
    const fileInfo = yield* fileSystem.stat(filePath).pipe(Effect.orElseSucceed(() => undefined));
    if (!fileInfo || fileInfo.type !== "File") {
      return undefined;
    }
    if (fileInfo.size > BigInt(SKILL_DOCUMENT_MAX_BYTES)) {
      yield* Effect.logWarning("Skipping oversized skill document", {
        path: filePath,
        sizeBytes: fileInfo.size.toString(),
        maximumBytes: SKILL_DOCUMENT_MAX_BYTES,
      });
      return undefined;
    }
    const contents = yield* readTextWithinLimit(
      fileSystem,
      filePath,
      SKILL_DOCUMENT_MAX_BYTES,
    ).pipe(Effect.orElseSucceed(() => undefined));
    if (contents === undefined) {
      return undefined;
    }
    const directory = yield* fileSystem
      .realPath(path.dirname(filePath))
      .pipe(Effect.orElseSucceed(() => path.dirname(filePath)));
    const frontmatter = parseSkillFrontmatter(contents);
    return {
      name:
        name ??
        (frontmatter.kind === "parsed" && frontmatter.name
          ? frontmatter.name
          : path.basename(directory)),
      directory,
      body: skillBodyFromDocument(contents),
    };
  });

  const resolveDocuments: SkillLibrary["Service"]["resolveDocuments"] = Effect.fn(
    "SkillLibrary.resolveDocuments",
  )(function* (skillIds) {
    if (skillIds.length === 0) {
      return [];
    }
    const locations = yield* collectLocations("resolve").pipe(
      Effect.orElseSucceed((): ReadonlyArray<Location> => []),
    );
    const resolved: Array<SkillDocument & { readonly id: SkillId }> = [];
    const seen = new Set<string>();
    for (const requested of skillIds) {
      const skillId = normalizeSkillId(requested);
      if (seen.has(skillId)) {
        continue;
      }
      seen.add(skillId);
      const skill = yield* resolveSkill("resolve", skillId, locations).pipe(
        Effect.catch((error) =>
          Effect.logWarning("Skipping a thread skill that is not installed", {
            skillId,
            detail: error.message,
          }).pipe(Effect.as(undefined)),
        ),
      );
      if (!skill) {
        continue;
      }
      const document = yield* readSkillDocument(undefined, skill.realPath);
      if (document) {
        resolved.push({ id: skillId, ...document });
      }
    }
    return resolved;
  });

  const resolveMentions: SkillLibrary["Service"]["resolveMentions"] = Effect.fn(
    "SkillLibrary.resolveMentions",
  )(function* (input) {
    const resolved: Array<SkillDocument> = [];
    const cwd = input.cwd;
    for (const name of input.names) {
      if (resolved.some((document) => skillNameMatches(document.name, name))) {
        continue;
      }
      // Project roots beat the provider's own list, matching how the CLIs
      // resolve a name (project scope over user scope).
      const candidate = input.candidates.find((skill) => skillNameMatches(skill.name, name));
      const locations = [
        ...(cwd === undefined
          ? []
          : WORKSPACE_SKILL_ROOTS.map((segments) => ({
              name,
              location: path.join(cwd, ...segments, name),
            }))),
        ...(candidate ? [{ name: candidate.name, location: candidate.path }] : []),
      ];
      for (const entry of locations) {
        const document = yield* readSkillDocument(entry.name, entry.location);
        if (document !== undefined) {
          resolved.push(document);
          break;
        }
      }
    }
    return resolved;
  });

  // ponytail: one-shot cleanup of copies older servers wrote into workspaces;
  // drop this (and the marker constant) once every environment has run a
  // server with the library.
  const removeManagedWorkspaceCopies: SkillLibrary["Service"]["removeManagedWorkspaceCopies"] =
    Effect.fn("SkillLibrary.removeManagedWorkspaceCopies")(function* (cwd) {
      for (const segments of WORKSPACE_SKILL_ROOTS) {
        const root = path.join(cwd, ...segments);
        const entries = yield* fileSystem
          .readDirectory(root)
          .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
        for (const entry of entries) {
          const target = path.join(root, entry);
          if (!(yield* exists(path.join(target, LEGACY_MANAGED_MARKER_FILE)))) {
            continue;
          }
          yield* fileSystem
            .remove(target, { recursive: true, force: true })
            .pipe(Effect.orElseSucceed(() => undefined));
        }
      }
    });

  /**
   * Skill directories below one legacy repo dir, as relative segment lists.
   * A skill directory is a leaf: nested `SKILL.md` files inside it are part
   * of that skill.
   */
  const collectLegacySkillDirs = Effect.fn("SkillLibrary.collectLegacySkillDirs")(function* (
    directory: string,
    segments: ReadonlyArray<string>,
  ): Effect.fn.Return<Array<ReadonlyArray<string>>> {
    const entries = yield* fileSystem
      .readDirectory(directory)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    const found: Array<ReadonlyArray<string>> = [];
    for (const entry of [...entries].sort()) {
      if (entry.startsWith(".")) {
        continue;
      }
      const entryPath = path.join(directory, entry);
      if (!(yield* isDirectory(entryPath))) {
        continue;
      }
      const childSegments = [...segments, entry];
      if (yield* exists(path.join(entryPath, SKILL_FILE))) {
        found.push(childSegments);
      } else if (childSegments.length < LEGACY_STORE_SCAN_MAX_DEPTH) {
        found.push(...(yield* collectLegacySkillDirs(entryPath, childSegments)));
      }
    }
    return found;
  });

  /** Move the pre-library store into the shared library, then delete it. */
  const migrateLegacyStore = Effect.gen(function* () {
    const storeRoot = path.resolve(config.skillsDir);
    if (!(yield* isDirectory(storeRoot))) {
      return;
    }
    const locations = yield* collectLocations("migrate");
    const shared = locations.find((location) => location.key === SHARED_LOCATION_KEY)!;
    let moved = 0;
    let dropped = 0;
    const repoDirNames = yield* fileSystem
      .readDirectory(storeRoot)
      .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
    for (const repoDirName of repoDirNames) {
      const separator = repoDirName.indexOf("--");
      if (separator <= 0) {
        continue;
      }
      const owner = repoDirName.slice(0, separator);
      const repo = repoDirName.slice(separator + 2);
      const repoDir = path.join(storeRoot, repoDirName);
      for (const segments of yield* collectLegacySkillDirs(repoDir, [])) {
        const last = segments[segments.length - 1]!;
        const dirName = last === "@root" ? repo : last;
        const skillDir = path.join(repoDir, ...segments);
        if (isSafeSegment(dirName) && !(yield* exists(path.join(shared.directory, dirName)))) {
          const placed = yield* placeInLibrary("migrate", locations, {
            dirName,
            directory: skillDir,
            source: { repo: `${owner}/${repo}`, path: segments.join("/") },
          }).pipe(
            Effect.as(true),
            Effect.catch((error) =>
              Effect.logWarning("Failed to move a legacy store skill into the library", {
                skill: dirName,
                detail: error.message,
              }).pipe(Effect.as(false)),
            ),
          );
          if (!placed) {
            continue;
          }
          moved += 1;
        } else {
          dropped += 1;
        }
        yield* fileSystem
          .remove(skillDir, { recursive: true, force: true })
          .pipe(Effect.orElseSucceed(() => undefined));
      }
    }
    const removed = yield* fileSystem.remove(storeRoot, { recursive: true, force: true }).pipe(
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
    if (moved > 0 || dropped > 0 || removed) {
      yield* Effect.logInfo("Moved the legacy skill store into the shared library", {
        moved,
        droppedDuplicates: dropped,
        library: abbreviateHome(shared.directory),
      });
    }
  }).pipe(
    Effect.catch((error) =>
      Effect.logWarning("Legacy skill store migration failed; the store is left in place", {
        detail: error.message,
      }),
    ),
  );

  yield* migrateLegacyStore;

  return SkillLibrary.of({
    getState,
    installFromDirectory,
    uninstall,
    setLocationEnabled,
    resolveDocuments,
    resolveMentions,
    removeManagedWorkspaceCopies,
  });
});

export const layer = Layer.effect(SkillLibrary, make);
