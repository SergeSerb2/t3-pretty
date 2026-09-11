import {
  EnvironmentId,
  ProjectId,
  ThreadId,
  type ScopedProjectRef,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

export class InvalidScopedProjectKeyError extends Schema.TaggedErrorClass<InvalidScopedProjectKeyError>()(
  "InvalidScopedProjectKeyError",
  {
    key: Schema.String,
  },
) {
  override get message(): string {
    return `Invalid scoped project atom key: ${JSON.stringify(this.key)}.`;
  }
}

export class InvalidScopedThreadKeyError extends Schema.TaggedErrorClass<InvalidScopedThreadKeyError>()(
  "InvalidScopedThreadKeyError",
  {
    key: Schema.String,
  },
) {
  override get message(): string {
    return `Invalid scoped thread atom key: ${JSON.stringify(this.key)}.`;
  }
}

export class InvalidScopedProjectRefCollectionKeyError extends Schema.TaggedErrorClass<InvalidScopedProjectRefCollectionKeyError>()(
  "InvalidScopedProjectRefCollectionKeyError",
  {
    key: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Invalid scoped project reference collection atom key: ${JSON.stringify(this.key)}.`;
  }
}

const decodeProjectKey = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Tuple([EnvironmentId, ProjectId])),
);
const decodeThreadKey = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Tuple([EnvironmentId, ThreadId])),
);
const decodeProjectRefCollectionKey = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Array(Schema.Tuple([EnvironmentId, ProjectId]))),
);

export function projectKey(ref: ScopedProjectRef): string {
  return JSON.stringify([ref.environmentId, ref.projectId]);
}

export function threadKey(ref: ScopedThreadRef): string {
  return JSON.stringify([ref.environmentId, ref.threadId]);
}

export function projectRefCollectionKey(refs: ReadonlyArray<ScopedProjectRef>): string {
  return JSON.stringify(refs.map((ref) => [ref.environmentId, ref.projectId]));
}

export function parseProjectKey(key: string): ScopedProjectRef {
  let ref: readonly [EnvironmentId, ProjectId];
  try {
    ref = decodeProjectKey(key);
  } catch {
    throw new InvalidScopedProjectKeyError({ key });
  }
  return {
    environmentId: ref[0],
    projectId: ref[1],
  };
}

export function parseProjectRefCollectionKey(key: string): ReadonlyArray<ScopedProjectRef> {
  let entries: ReadonlyArray<readonly [string, string]>;
  try {
    entries = decodeProjectRefCollectionKey(key);
  } catch (cause) {
    throw new InvalidScopedProjectRefCollectionKeyError({ key, cause });
  }
  return entries.map(([environmentId, projectId]) => ({
    environmentId: EnvironmentId.make(environmentId),
    projectId: ProjectId.make(projectId),
  }));
}

export function parseThreadKey(key: string): ScopedThreadRef {
  let ref: readonly [EnvironmentId, ThreadId];
  try {
    ref = decodeThreadKey(key);
  } catch {
    throw new InvalidScopedThreadKeyError({ key });
  }
  return {
    environmentId: ref[0],
    threadId: ref[1],
  };
}

export function projectRefsEqual(
  left: ReadonlyArray<ScopedProjectRef>,
  right: ReadonlyArray<ScopedProjectRef>,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (ref, index) =>
        ref.environmentId === right[index]?.environmentId &&
        ref.projectId === right[index]?.projectId,
    )
  );
}

export function threadRefsEqual(
  left: ReadonlyArray<ScopedThreadRef>,
  right: ReadonlyArray<ScopedThreadRef>,
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (ref, index) =>
        ref.environmentId === right[index]?.environmentId &&
        ref.threadId === right[index]?.threadId,
    )
  );
}

export function arrayElementsEqual<A>(left: ReadonlyArray<A>, right: ReadonlyArray<A>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
