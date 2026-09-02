#!/usr/bin/env node

import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as String from "effect/String";
import { Command, Flag } from "effect/unstable/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

const ReleaseChannel = Schema.Literals(["stable", "nightly"]);
type ReleaseChannel = typeof ReleaseChannel.Type;

export class InvalidReleaseTagError extends Schema.TaggedErrorClass<InvalidReleaseTagError>()(
  "InvalidReleaseTagError",
  {
    channel: ReleaseChannel,
    currentTag: Schema.String,
  },
) {
  override get message(): string {
    return `Invalid ${this.channel} release tag '${this.currentTag}'.`;
  }
}

const NonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const releaseTagListProcessContext = {
  executable: Schema.Literal("git"),
  argumentCount: NonNegativeInt,
  cwd: Schema.String,
};

export class ReleaseTagListProcessError extends Schema.TaggedErrorClass<ReleaseTagListProcessError>()(
  "ReleaseTagListProcessError",
  {
    ...releaseTagListProcessContext,
    operation: Schema.Literals(["spawn", "read-stdout", "read-stderr", "wait-for-exit"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to list release tags during process operation "${this.operation}".`;
  }
}

export class ReleaseTagListProcessExitError extends Schema.TaggedErrorClass<ReleaseTagListProcessExitError>()(
  "ReleaseTagListProcessExitError",
  {
    ...releaseTagListProcessContext,
    exitCode: Schema.Number,
    stdoutLength: NonNegativeInt,
    stderrLength: NonNegativeInt,
  },
) {
  override get message(): string {
    return `Release tag listing exited with code ${this.exitCode}.`;
  }
}

export class ReleaseTagListOutputTooLargeError extends Schema.TaggedErrorClass<ReleaseTagListOutputTooLargeError>()(
  "ReleaseTagListOutputTooLargeError",
  {
    ...releaseTagListProcessContext,
    stream: Schema.Literals(["stdout", "stderr"]),
    maxOutputBytes: NonNegativeInt,
  },
) {
  override get message(): string {
    return `Git tag listing ${this.stream} exceeded the ${this.maxOutputBytes}-byte safety limit.`;
  }
}

export class PreviousReleaseTagGitHubOutputConfigError extends Schema.TaggedErrorClass<PreviousReleaseTagGitHubOutputConfigError>()(
  "PreviousReleaseTagGitHubOutputConfigError",
  {
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return "Failed to resolve the GITHUB_OUTPUT path for the previous release tag.";
  }
}

export class PreviousReleaseTagGitHubOutputAppendError extends Schema.TaggedErrorClass<PreviousReleaseTagGitHubOutputAppendError>()(
  "PreviousReleaseTagGitHubOutputAppendError",
  {
    outputPath: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to append the previous release tag to ${this.outputPath}.`;
  }
}

interface StableVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: ReadonlyArray<string>;
}

interface NightlyVersion {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly date: number;
  readonly runNumber: number;
}

const parseNumericIdentifier = (identifier: string): number | undefined =>
  /^\d+$/.test(identifier) ? Number(identifier) : undefined;

const comparePrereleaseIdentifiers = (left: string, right: string): number => {
  const leftNumeric = parseNumericIdentifier(left);
  const rightNumeric = parseNumericIdentifier(right);

  if (leftNumeric !== undefined && rightNumeric !== undefined) {
    return leftNumeric - rightNumeric;
  }
  if (leftNumeric !== undefined) {
    return -1;
  }
  if (rightNumeric !== undefined) {
    return 1;
  }
  return left.localeCompare(right);
};

const compareStableVersions = (left: StableVersion, right: StableVersion): number => {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  const leftHasPrerelease = left.prerelease.length > 0;
  const rightHasPrerelease = right.prerelease.length > 0;
  if (!leftHasPrerelease && !rightHasPrerelease) return 0;
  if (!leftHasPrerelease) return 1;
  if (!rightHasPrerelease) return -1;

  const maxLength = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftIdentifier = left.prerelease[index];
    const rightIdentifier = right.prerelease[index];
    if (leftIdentifier === undefined) return -1;
    if (rightIdentifier === undefined) return 1;

    const comparison = comparePrereleaseIdentifiers(leftIdentifier, rightIdentifier);
    if (comparison !== 0) return comparison;
  }

  return 0;
};

const parseStableTag = (tag: string): StableVersion | undefined => {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(tag);
  if (!match) return undefined;

  const [, major, minor, patch, prerelease] = match;
  if (!major || !minor || !patch) return undefined;

  const prereleaseIdentifiers = prerelease ? prerelease.split(".") : [];
  // Nightly tags also start with `v` and carry a `nightly.*` prerelease
  // identifier. They must not be considered stable candidates when resolving
  // the previous stable tag.
  if (prereleaseIdentifiers[0] === "nightly") return undefined;

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prereleaseIdentifiers,
  };
};

const compareNightlyVersions = (left: NightlyVersion, right: NightlyVersion): number => {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;
  if (left.date !== right.date) return left.date - right.date;
  return left.runNumber - right.runNumber;
};

const parseNightlyTag = (tag: string): NightlyVersion | undefined => {
  // Accept both the current `v<semver>` format and the legacy `nightly-v<semver>`
  // format so release note diffs keep working across the tag-format transition.
  const match = /^(?:nightly-)?v(\d+)\.(\d+)\.(\d+)-nightly\.(\d{8})\.(\d+)$/.exec(tag);
  if (!match) return undefined;

  const [, major, minor, patch, date, runNumber] = match;
  if (!major || !minor || !patch || !date || !runNumber) return undefined;

  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    date: Number(date),
    runNumber: Number(runNumber),
  };
};

export const resolvePreviousReleaseTag = (
  channel: ReleaseChannel,
  currentTag: string,
  tags: ReadonlyArray<string>,
) =>
  Effect.gen(function* () {
    if (channel === "stable") {
      const current = parseStableTag(currentTag);
      if (!current) {
        return yield* new InvalidReleaseTagError({ channel, currentTag });
      }

      let previous: { readonly tag: string; readonly parsed: StableVersion } | undefined;
      for (const tag of tags) {
        const parsed = parseStableTag(tag);
        if (
          parsed &&
          compareStableVersions(parsed, current) < 0 &&
          (!previous || compareStableVersions(parsed, previous.parsed) > 0)
        ) {
          previous = { tag, parsed };
        }
      }
      return previous?.tag;
    }

    const current = parseNightlyTag(currentTag);
    if (!current) {
      return yield* new InvalidReleaseTagError({ channel, currentTag });
    }

    let previous: { readonly tag: string; readonly parsed: NightlyVersion } | undefined;
    for (const tag of tags) {
      const parsed = parseNightlyTag(tag);
      if (
        parsed &&
        compareNightlyVersions(parsed, current) < 0 &&
        (!previous || compareNightlyVersions(parsed, previous.parsed) > 0)
      ) {
        previous = { tag, parsed };
      }
    }
    return previous?.tag;
  });

const RELEASE_TAG_LIST_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

interface BoundedStreamText {
  readonly text: string;
  readonly truncated: boolean;
}

const collectStreamAsString = <E>(
  stream: Stream.Stream<Uint8Array, E>,
  maxOutputBytes: number,
): Effect.Effect<BoundedStreamText, E> =>
  stream.pipe(
    Stream.runFold(
      () => ({ chunks: [] as Array<Uint8Array>, retainedBytes: 0, truncated: false }),
      (state, chunk) => {
        if (state.truncated) return state;
        const remaining = maxOutputBytes - state.retainedBytes;
        if (chunk.byteLength <= remaining) {
          state.chunks.push(chunk);
          return {
            chunks: state.chunks,
            retainedBytes: state.retainedBytes + chunk.byteLength,
            truncated: false,
          };
        }
        if (remaining > 0) state.chunks.push(chunk.slice(0, remaining));
        return {
          chunks: state.chunks,
          retainedBytes: maxOutputBytes,
          truncated: true,
        };
      },
    ),
    Effect.map((state) => {
      const bytes = new Uint8Array(state.retainedBytes);
      let offset = 0;
      for (const chunk of state.chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return {
        text: new TextDecoder().decode(bytes),
        truncated: state.truncated,
      };
    }),
  );

export const listGitTags = Effect.fn("listGitTags")(function* (
  cwd = process.cwd(),
  maxOutputBytes = RELEASE_TAG_LIST_MAX_OUTPUT_BYTES,
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const args = ["tag", "--list"] as const;
  const context = {
    executable: "git",
    argumentCount: args.length,
    cwd,
  } as const;
  const child = yield* spawner.spawn(ChildProcess.make("git", args, { cwd })).pipe(
    Effect.mapError(
      (cause) =>
        new ReleaseTagListProcessError({
          ...context,
          operation: "spawn",
          cause,
        }),
    ),
  );
  const [stdout, stderr, exitCode] = yield* Effect.all(
    [
      collectStreamAsString(child.stdout, maxOutputBytes).pipe(
        Effect.mapError(
          (cause) =>
            new ReleaseTagListProcessError({
              ...context,
              operation: "read-stdout",
              cause,
            }),
        ),
      ),
      collectStreamAsString(child.stderr, maxOutputBytes).pipe(
        Effect.mapError(
          (cause) =>
            new ReleaseTagListProcessError({
              ...context,
              operation: "read-stderr",
              cause,
            }),
        ),
      ),
      child.exitCode.pipe(
        Effect.map(Number),
        Effect.mapError(
          (cause) =>
            new ReleaseTagListProcessError({
              ...context,
              operation: "wait-for-exit",
              cause,
            }),
        ),
      ),
    ],
    { concurrency: "unbounded" },
  );

  if (stdout.truncated || stderr.truncated) {
    return yield* new ReleaseTagListOutputTooLargeError({
      ...context,
      stream: stdout.truncated ? "stdout" : "stderr",
      maxOutputBytes,
    });
  }

  if (exitCode !== 0) {
    return yield* new ReleaseTagListProcessExitError({
      ...context,
      exitCode,
      stdoutLength: stdout.text.length,
      stderrLength: stderr.text.length,
    });
  }

  return stdout.text.split(/\r?\n/).map(String.trim).filter(String.isNonEmpty);
});

export const writePreviousReleaseTagOutput = Effect.fn("writePreviousReleaseTagOutput")(function* (
  previousTag: string | undefined,
  writeGithubOutput: boolean,
) {
  const entry = `previous_tag=${previousTag ?? ""}\n`;

  if (writeGithubOutput) {
    const fs = yield* FileSystem.FileSystem;
    const githubOutputPath = yield* Config.nonEmptyString("GITHUB_OUTPUT").pipe(
      Effect.mapError(
        (cause) =>
          new PreviousReleaseTagGitHubOutputConfigError({
            cause,
          }),
      ),
    );
    yield* fs.writeFileString(githubOutputPath, entry, { flag: "a" }).pipe(
      Effect.mapError(
        (cause) =>
          new PreviousReleaseTagGitHubOutputAppendError({
            outputPath: githubOutputPath,
            cause,
          }),
      ),
    );
    return;
  }

  process.stdout.write(entry);
});

const command = Command.make(
  "resolve-previous-release-tag",
  {
    channel: Flag.choice("channel", ReleaseChannel.literals).pipe(
      Flag.withDescription("Release channel whose previous tag should be resolved."),
    ),
    currentTag: Flag.string("current-tag").pipe(
      Flag.withDescription("Current release tag to compare against."),
    ),
    githubOutput: Flag.boolean("github-output").pipe(
      Flag.withDescription("Write values to GITHUB_OUTPUT instead of stdout."),
      Flag.withDefault(false),
    ),
  },
  ({ channel, currentTag, githubOutput }) =>
    listGitTags().pipe(
      Effect.flatMap((tags) => resolvePreviousReleaseTag(channel, currentTag, tags)),
      Effect.flatMap((previousTag) => writePreviousReleaseTagOutput(previousTag, githubOutput)),
    ),
).pipe(Command.withDescription("Resolve the previous release tag for a stable or nightly series."));

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
