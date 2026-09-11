// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeReadline from "node:readline";
import type * as NodeStream from "node:stream";

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { decodeJsonResult } from "@t3tools/shared/schemaJson";
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";

export class BootstrapFdStatError extends Schema.TaggedErrorClass<BootstrapFdStatError>()(
  "BootstrapFdStatError",
  {
    fd: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to stat bootstrap file descriptor ${this.fd}.`;
  }
}

export class BootstrapInputStreamOpenError extends Schema.TaggedErrorClass<BootstrapInputStreamOpenError>()(
  "BootstrapInputStreamOpenError",
  {
    fd: Schema.Number,
    platform: Schema.String,
    fdPath: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    const path = this.fdPath === undefined ? "" : ` via '${this.fdPath}'`;
    return `Failed to open bootstrap input stream for file descriptor ${this.fd}${path} on '${this.platform}'.`;
  }
}

export class BootstrapEnvelopeReadError extends Schema.TaggedErrorClass<BootstrapEnvelopeReadError>()(
  "BootstrapEnvelopeReadError",
  {
    fd: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to read bootstrap envelope from file descriptor ${this.fd}.`;
  }
}

export class BootstrapEnvelopeDecodeError extends Schema.TaggedErrorClass<BootstrapEnvelopeDecodeError>()(
  "BootstrapEnvelopeDecodeError",
  {
    fd: Schema.Number,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to decode bootstrap envelope from file descriptor ${this.fd}.`;
  }
}

export const BOOTSTRAP_ENVELOPE_MAX_BYTES = 64 * 1024;

export class BootstrapEnvelopeTooLargeError extends Schema.TaggedErrorClass<BootstrapEnvelopeTooLargeError>()(
  "BootstrapEnvelopeTooLargeError",
  {
    fd: Schema.Number,
    maxBytes: Schema.Number,
  },
) {
  override get message(): string {
    return `Bootstrap envelope from file descriptor ${this.fd} exceeded ${this.maxBytes} bytes.`;
  }
}

export const BootstrapError = Schema.Union([
  BootstrapFdStatError,
  BootstrapInputStreamOpenError,
  BootstrapEnvelopeReadError,
  BootstrapEnvelopeDecodeError,
  BootstrapEnvelopeTooLargeError,
]);
export type BootstrapError = typeof BootstrapError.Type;

export const readBootstrapEnvelope = Effect.fn("readBootstrapEnvelope")(function* <A, I>(
  schema: Schema.Codec<A, I>,
  fd: number,
  options?: {
    timeoutMs?: number;
  },
): Effect.fn.Return<Option.Option<A>, BootstrapError> {
  const fdReady = yield* isFdReady(fd);
  if (!fdReady) return Option.none();

  const stream = yield* makeBootstrapInputStream(fd);

  const timeoutMs = options?.timeoutMs ?? 1000;

  return yield* Effect.callback<
    Option.Option<A>,
    BootstrapEnvelopeReadError | BootstrapEnvelopeDecodeError | BootstrapEnvelopeTooLargeError
  >((resume) => {
    const input = NodeReadline.createInterface({
      input: stream,
      crlfDelay: Infinity,
    });
    let firstLineBytes = 0;
    let firstLineEnded = false;

    const cleanup = () => {
      stream.removeListener("error", handleError);
      stream.removeListener("data", handleData);
      input.removeListener("line", handleLine);
      input.removeListener("close", handleClose);
      input.close();
      stream.destroy();
    };

    const handleError = (error: Error) => {
      if (isUnavailableBootstrapFdError(error)) {
        resume(Effect.succeedNone);
        return;
      }
      resume(
        Effect.fail(
          new BootstrapEnvelopeReadError({
            fd,
            cause: error,
          }),
        ),
      );
    };

    const handleData = (chunk: string | Buffer) => {
      if (firstLineEnded) return;
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const lineFeedIndex = text.indexOf("\n");
      const carriageReturnIndex = text.indexOf("\r");
      const terminatorIndex =
        lineFeedIndex === -1
          ? carriageReturnIndex
          : carriageReturnIndex === -1
            ? lineFeedIndex
            : Math.min(lineFeedIndex, carriageReturnIndex);
      const firstLineChunk = terminatorIndex === -1 ? text : text.slice(0, terminatorIndex);
      firstLineBytes += Buffer.byteLength(firstLineChunk, "utf8");
      firstLineEnded = terminatorIndex !== -1;
      if (firstLineBytes <= BOOTSTRAP_ENVELOPE_MAX_BYTES) return;
      resume(
        Effect.fail(
          new BootstrapEnvelopeTooLargeError({
            fd,
            maxBytes: BOOTSTRAP_ENVELOPE_MAX_BYTES,
          }),
        ),
      );
    };

    const handleLine = (line: string) => {
      const parsed = decodeJsonResult(schema)(line);
      if (Result.isSuccess(parsed)) {
        resume(Effect.succeedSome(parsed.success));
      } else {
        resume(
          Effect.fail(
            new BootstrapEnvelopeDecodeError({
              fd,
              cause: parsed.failure,
            }),
          ),
        );
      }
    };

    const handleClose = () => {
      resume(Effect.succeedNone);
    };

    stream.once("error", handleError);
    // readline's internal line buffer has no maximum. Run this listener first
    // so an unterminated bootstrap record is rejected before readline retains
    // more than the bounded prefix.
    stream.prependListener("data", handleData);
    input.once("line", handleLine);
    input.once("close", handleClose);

    return Effect.sync(cleanup);
  }).pipe(Effect.timeoutOption(timeoutMs), Effect.map(Option.flatten));
});

const isUnavailableBootstrapFdError = Predicate.compose(
  Predicate.hasProperty("code"),
  (_) => _.code === "EBADF" || _.code === "ENOENT",
);

const isFdReady = (fd: number) =>
  Effect.try({
    try: () => NodeFS.fstatSync(fd),
    catch: (error) =>
      new BootstrapFdStatError({
        fd,
        cause: error,
      }),
  }).pipe(
    Effect.as(true),
    Effect.catchTags({
      BootstrapFdStatError: (error) =>
        isUnavailableBootstrapFdError(error.cause) ? Effect.succeed(false) : Effect.fail(error),
    }),
  );

const makeBootstrapInputStream = (fd: number) =>
  Effect.gen(function* () {
    const platform = yield* HostProcessPlatform;
    const fdPath = resolveFdPath(fd, platform);
    return yield* Effect.try<NodeStream.Readable, BootstrapInputStreamOpenError>({
      try: () => {
        if (fdPath === undefined) {
          return makeDirectBootstrapStream(fd);
        }

        let streamFd: number | undefined;
        try {
          streamFd = NodeFS.openSync(fdPath, "r");
          return NodeFS.createReadStream("", {
            fd: streamFd,
            encoding: "utf8",
            autoClose: true,
          });
        } catch (error) {
          if (isBootstrapFdPathDuplicationError(error)) {
            if (streamFd !== undefined) {
              NodeFS.closeSync(streamFd);
            }
            return makeDirectBootstrapStream(fd);
          }
          throw error;
        }
      },
      catch: (error) =>
        new BootstrapInputStreamOpenError({
          fd,
          platform,
          ...(fdPath === undefined ? {} : { fdPath }),
          cause: error,
        }),
    });
  });

const makeDirectBootstrapStream = (fd: number): NodeStream.Readable => {
  try {
    return NodeFS.createReadStream("", {
      fd,
      encoding: "utf8",
      autoClose: true,
    });
  } catch {
    const stream = new NodeNet.Socket({
      fd,
      readable: true,
      writable: false,
    });
    stream.setEncoding("utf8");
    return stream;
  }
};

// Stdin pipes inherited across the wsl.exe boundary report EACCES when we try
// to re-open them via /proc/self/fd/0 — fall back to reading the fd directly
// in that case, the same way we already do for ENXIO/EINVAL/EPERM.
const isBootstrapFdPathDuplicationError = Predicate.compose(
  Predicate.hasProperty("code"),
  (_) => _.code === "ENXIO" || _.code === "EINVAL" || _.code === "EPERM" || _.code === "EACCES",
);

function resolveFdPath(fd: number, platform: NodeJS.Platform): string | undefined {
  if (platform === "linux") {
    return `/proc/self/fd/${fd}`;
  }
  if (platform === "win32") {
    return undefined;
  }
  return `/dev/fd/${fd}`;
}
