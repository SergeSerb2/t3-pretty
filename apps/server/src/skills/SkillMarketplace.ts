/**
 * SkillMarketplace — browses and installs skills from the GitHub marketplace
 * sources configured in `ServerSettings.skills.marketplaceSources`.
 *
 * Each source repo is downloaded once as a tarball
 * (`https://codeload.github.com/<owner>/<repo>/tar.gz/HEAD`) and cached under
 * `skillMarketplaceCacheDir` as `<owner>--<repo>.tar.gz` plus a derived
 * `<owner>--<repo>.listing.json`. Listings serve from cache while fresh
 * (6h) and fall back to a stale cache when a re-download fails; a source only
 * surfaces as a `SkillsError` when every requested source failed.
 *
 * @module skills/SkillMarketplace
 */
import {
  SkillsError,
  type SkillId,
  type SkillMarketplaceListing,
  type SkillsState,
} from "@t3tools/contracts";
import { parseSkillFrontmatter } from "@t3tools/shared/skillFrontmatter";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { fromJsonStringPretty, fromLenientJson } from "@t3tools/shared/schemaJson";
import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as SkillStore from "./SkillStore.ts";
import { listTarGzEntries, type TarEntry } from "./Untar.ts";

/** How long a downloaded listing is served without re-fetching. */
const LISTING_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 30_000;
/** Marketplace skill directories sit at most this deep below the repo root. */
const MARKETPLACE_MAX_DEPTH = 5;

/** Cached listing on disk; the `installed` flag is derived fresh on every read. */
const CachedMarketplaceListing = Schema.Struct({
  repo: Schema.String,
  fetchedAt: Schema.String,
  skills: Schema.Array(
    Schema.Struct({
      sourcePath: Schema.String,
      name: Schema.String,
      description: Schema.optional(Schema.String),
    }),
  ),
});
type CachedMarketplaceListing = typeof CachedMarketplaceListing.Type;

const CachedMarketplaceListingJson = fromLenientJson(CachedMarketplaceListing);
const CachedMarketplaceListingPrettyJson = fromJsonStringPretty(CachedMarketplaceListing);
const decodeCachedMarketplaceListing = Schema.decodeUnknownEffect(CachedMarketplaceListingJson);
const encodeCachedMarketplaceListing = Schema.encodeEffect(CachedMarketplaceListingPrettyJson);
const isSkillsError = Schema.is(SkillsError);

export interface SkillMarketplaceQuery {
  readonly repo?: string;
}

export class SkillMarketplace extends Context.Service<
  SkillMarketplace,
  {
    /** List the configured marketplace sources, serving fresh cache when present. */
    readonly list: (
      input: SkillMarketplaceQuery,
    ) => Effect.Effect<ReadonlyArray<SkillMarketplaceListing>, SkillsError>;

    /** Re-download every requested source, then list it. */
    readonly refresh: (
      input: SkillMarketplaceQuery,
    ) => Effect.Effect<ReadonlyArray<SkillMarketplaceListing>, SkillsError>;

    /** Install a marketplace skill into the central store. */
    readonly install: (skillId: SkillId) => Effect.Effect<SkillsState, SkillsError>;
  }
>()("t3/skills/SkillMarketplace") {}

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const skillStore = yield* SkillStore.SkillStore;

  const cachePaths = (owner: string, repo: string) => {
    const key = SkillStore.formatSkillRepoDirName(owner, repo);
    return {
      tarball: path.join(config.skillMarketplaceCacheDir, `${key}.tar.gz`),
      listing: path.join(config.skillMarketplaceCacheDir, `${key}.listing.json`),
    };
  };

  const readCachedListing = Effect.fn("SkillMarketplace.readCachedListing")(function* (
    sourceRepo: string,
    owner: string,
    repo: string,
  ) {
    const contents = yield* fileSystem
      .readFileString(cachePaths(owner, repo).listing)
      .pipe(Effect.orElseSucceed(() => undefined));
    if (contents === undefined) {
      return undefined;
    }
    const decoded = yield* decodeCachedMarketplaceListing(contents).pipe(
      Effect.orElseSucceed(() => undefined),
    );
    if (decoded === undefined || decoded.repo !== sourceRepo) {
      return undefined;
    }
    return decoded;
  });

  const fetchRepoTarball = Effect.fn("SkillMarketplace.fetchRepoTarball")(function* (
    operation: SkillsError["operation"],
    sourceRepo: string,
  ): Effect.fn.Return<Uint8Array, SkillsError> {
    const request = HttpClientRequest.get(`https://codeload.github.com/${sourceRepo}/tar.gz/HEAD`);
    const response = yield* httpClient.execute(request).pipe(
      Effect.timeout(FETCH_TIMEOUT_MS),
      Effect.mapError(
        (cause) =>
          new SkillsError({
            operation,
            sourceRepo,
            message: `Failed to download ${sourceRepo} from GitHub.`,
            cause,
          }),
      ),
    );
    if (response.status !== 200) {
      return yield* new SkillsError({
        operation,
        sourceRepo,
        message: `GitHub returned HTTP ${response.status} for ${sourceRepo}.`,
      });
    }
    const buffer = yield* response.arrayBuffer.pipe(
      Effect.mapError(
        (cause) =>
          new SkillsError({
            operation,
            sourceRepo,
            message: `Failed to read the ${sourceRepo} tarball response.`,
            cause,
          }),
      ),
    );
    return new Uint8Array(buffer);
  });

  /** Entry paths minus the archive's top-level `<repo>-<sha>/` folder. */
  const relativeEntryPath = (entry: TarEntry): string | null => {
    const separatorIndex = entry.name.indexOf("/");
    if (separatorIndex <= 0 || separatorIndex === entry.name.length - 1) {
      return null;
    }
    return entry.name.slice(separatorIndex + 1);
  };

  const buildListing = (
    sourceRepo: string,
    entries: ReadonlyArray<TarEntry>,
    fetchedAt: string,
  ): CachedMarketplaceListing => {
    const skills: Array<CachedMarketplaceListing["skills"][number]> = [];
    for (const entry of entries) {
      if (entry.type !== "file") {
        continue;
      }
      const relativePath = relativeEntryPath(entry);
      if (!relativePath || !relativePath.endsWith("/SKILL.md")) {
        continue;
      }
      const sourcePath = relativePath.slice(0, -"/SKILL.md".length);
      const segments = sourcePath.split("/");
      if (
        segments.length > MARKETPLACE_MAX_DEPTH ||
        segments.some((segment) => segment.startsWith(".")) ||
        SkillStore.parseSkillSourcePath(sourcePath) === null
      ) {
        continue;
      }
      const frontmatter = parseSkillFrontmatter(new TextDecoder().decode(entry.data));
      skills.push({
        sourcePath,
        name:
          frontmatter.kind === "parsed" && frontmatter.name
            ? frontmatter.name
            : segments[segments.length - 1]!,
        ...(frontmatter.kind === "parsed" && frontmatter.description
          ? { description: frontmatter.description }
          : {}),
      });
    }
    skills.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
    return { repo: sourceRepo, fetchedAt, skills };
  };

  /** Best-effort cache persistence; a failed write never fails the listing. */
  const writeCache = (
    owner: string,
    repo: string,
    tarball: Uint8Array,
    listing: CachedMarketplaceListing,
  ) =>
    Effect.gen(function* () {
      const paths = cachePaths(owner, repo);
      const encoded = yield* encodeCachedMarketplaceListing(listing);
      yield* fileSystem.makeDirectory(path.dirname(paths.tarball), { recursive: true });
      yield* fileSystem.writeFile(paths.tarball, tarball);
      yield* fileSystem.writeFileString(paths.listing, encoded);
    }).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Failed to persist the skill marketplace cache", { cause }),
      ),
    );

  const parseEntries = (
    operation: SkillsError["operation"],
    sourceRepo: string,
    tarball: Uint8Array,
  ) =>
    Effect.try({
      try: () => listTarGzEntries(tarball),
      catch: (cause) =>
        new SkillsError({
          operation,
          sourceRepo,
          message: `The ${sourceRepo} download is not a readable tarball.`,
          cause,
        }),
    });

  /** Fresh-or-stale cached listing for one source; fetches when missing/stale. */
  const getListing = Effect.fn("SkillMarketplace.getListing")(function* (
    operation: SkillsError["operation"],
    sourceRepo: string,
    options: { readonly forceRefresh: boolean },
  ): Effect.fn.Return<CachedMarketplaceListing, SkillsError> {
    const repoParts = SkillStore.parseSkillSourceRepo(sourceRepo);
    if (!repoParts) {
      return yield* new SkillsError({
        operation,
        sourceRepo,
        message: `Invalid marketplace source: ${sourceRepo}.`,
      });
    }
    const cached = yield* readCachedListing(sourceRepo, repoParts.owner, repoParts.repo);
    if (cached && !options.forceRefresh) {
      const fetchedAtMs = Date.parse(cached.fetchedAt);
      const nowMs = DateTime.toEpochMillis(yield* DateTime.now);
      if (!Number.isNaN(fetchedAtMs) && nowMs - fetchedAtMs < LISTING_CACHE_TTL_MS) {
        return cached;
      }
    }

    const fetched = yield* fetchRepoTarball(operation, sourceRepo).pipe(Effect.result);
    if (fetched._tag === "Failure") {
      if (cached) {
        yield* Effect.logWarning("Skill marketplace refresh failed; serving stale cache", {
          sourceRepo,
        });
        return cached;
      }
      return yield* fetched.failure;
    }

    const tarball = fetched.success;
    const entries = yield* parseEntries(operation, sourceRepo, tarball);
    const listing = buildListing(sourceRepo, entries, DateTime.formatIso(yield* DateTime.now));
    yield* writeCache(repoParts.owner, repoParts.repo, tarball, listing);
    return listing;
  });

  const listOrRefresh = Effect.fn("SkillMarketplace.listOrRefresh")(function* (
    operation: "list-marketplace" | "refresh-marketplace",
    input: SkillMarketplaceQuery,
  ): Effect.fn.Return<ReadonlyArray<SkillMarketplaceListing>, SkillsError> {
    const settings = yield* serverSettings.getSettings.pipe(
      Effect.mapError(
        (cause) =>
          new SkillsError({
            operation,
            message: "Failed to read the server settings.",
            cause,
          }),
      ),
    );
    const repoFilter = input.repo?.trim();
    const sources = settings.skills.marketplaceSources.filter(
      (source) => repoFilter === undefined || repoFilter.length === 0 || source.repo === repoFilter,
    );
    if (sources.length === 0) {
      return [];
    }

    const installedIds = new Set(
      (yield* skillStore.getState).installedSkills.map((skill) => skill.id),
    );
    const settled = yield* Effect.forEach(
      sources,
      (source) =>
        getListing(operation, source.repo, {
          forceRefresh: operation === "refresh-marketplace",
        }).pipe(Effect.result),
      { concurrency: "unbounded" },
    );

    const listings: Array<SkillMarketplaceListing> = [];
    const failures: Array<SkillsError> = [];
    for (const result of settled) {
      if (Result.isSuccess(result)) {
        const listing = result.success;
        listings.push({
          repo: listing.repo,
          fetchedAt: listing.fetchedAt,
          skills: listing.skills.map((skill) => ({
            id: `${listing.repo}:${skill.sourcePath}`,
            name: skill.name,
            ...(skill.description ? { description: skill.description } : {}),
            sourcePath: skill.sourcePath,
            installed: installedIds.has(`${listing.repo}:${skill.sourcePath}`),
          })),
        });
      } else {
        failures.push(result.failure);
      }
    }

    if (listings.length === 0 && failures.length > 0) {
      const first = failures[0]!;
      return yield* new SkillsError({
        operation,
        sourceRepo: first.sourceRepo,
        message: `Failed to load every requested marketplace source (${failures.length} failed). First error: ${first.message}`,
        cause: first,
      });
    }
    return listings;
  });

  const list: SkillMarketplace["Service"]["list"] = (input) =>
    listOrRefresh("list-marketplace", input);

  const refresh: SkillMarketplace["Service"]["refresh"] = (input) =>
    listOrRefresh("refresh-marketplace", input);

  const install = Effect.fn("SkillMarketplace.install")(function* (
    skillId: SkillId,
  ): Effect.fn.Return<SkillsState, SkillsError> {
    const parsed = SkillStore.parseSkillId(skillId);
    if (!parsed) {
      return yield* new SkillsError({
        operation: "install",
        skillId,
        message: `Invalid skill id: ${skillId}.`,
      });
    }
    const toInstallError = (message: string) => (cause: unknown) =>
      new SkillsError({
        operation: "install",
        skillId,
        sourceRepo: parsed.sourceRepo,
        message,
        cause,
      });

    // The cached tarball is authoritative; it only downloads when never fetched.
    const cachedTarball = yield* fileSystem
      .readFile(cachePaths(parsed.owner, parsed.repo).tarball)
      .pipe(Effect.orElseSucceed(() => undefined));
    const tarball =
      cachedTarball ??
      (yield* Effect.gen(function* () {
        const downloaded = yield* fetchRepoTarball("install", parsed.sourceRepo);
        const entries = yield* parseEntries("install", parsed.sourceRepo, downloaded);
        const listing = buildListing(
          parsed.sourceRepo,
          entries,
          DateTime.formatIso(yield* DateTime.now),
        );
        yield* writeCache(parsed.owner, parsed.repo, downloaded, listing);
        return downloaded;
      }));
    const entries = yield* parseEntries("install", parsed.sourceRepo, tarball);

    const skillPrefix = `${parsed.sourcePath}/`;
    const files: Array<{ readonly segments: ReadonlyArray<string>; readonly data: Uint8Array }> =
      [];
    for (const entry of entries) {
      if (entry.type !== "file") {
        continue;
      }
      const relativePath = relativeEntryPath(entry);
      if (!relativePath || !relativePath.startsWith(skillPrefix)) {
        continue;
      }
      const innerPath = relativePath.slice(skillPrefix.length);
      const segments = innerPath.split("/");
      if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
        continue;
      }
      files.push({ segments, data: entry.data });
    }
    if (!files.some((file) => file.segments.length === 1 && file.segments[0] === "SKILL.md")) {
      return yield* new SkillsError({
        operation: "install",
        skillId,
        sourceRepo: parsed.sourceRepo,
        message: `Skill ${skillId} was not found in ${parsed.sourceRepo}. Refresh the marketplace and try again.`,
      });
    }

    const tempDir = yield* fileSystem
      .makeTempDirectory({ prefix: "t3-skill-install-" })
      .pipe(Effect.mapError(toInstallError("Failed to prepare the skill install directory.")));
    return yield* Effect.gen(function* () {
      for (const file of files) {
        const destination = path.join(tempDir, ...file.segments);
        yield* fileSystem.makeDirectory(path.dirname(destination), { recursive: true });
        yield* fileSystem.writeFile(destination, file.data);
      }
      return yield* skillStore.installFromDirectory({
        sourceRepo: parsed.sourceRepo,
        sourcePath: parsed.sourcePath,
        directory: tempDir,
      });
    }).pipe(
      Effect.mapError((cause) =>
        isSkillsError(cause)
          ? cause
          : new SkillsError({
              operation: "install",
              skillId,
              sourceRepo: parsed.sourceRepo,
              message: `Failed to install ${skillId}.`,
              cause,
            }),
      ),
      Effect.ensuring(
        fileSystem
          .remove(tempDir, { recursive: true, force: true })
          .pipe(Effect.orElseSucceed(() => undefined)),
      ),
    );
  });

  return SkillMarketplace.of({ list, refresh, install });
});

export const layer = Layer.effect(SkillMarketplace, make);
