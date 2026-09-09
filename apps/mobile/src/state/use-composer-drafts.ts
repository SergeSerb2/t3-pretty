import { isOwnedComposerPreviewUri } from "../lib/composerImages";
import type {
  DraftComposerImageAttachment,
  DraftComposerFileAttachment,
} from "../lib/composerImages";
import { useAtomValue } from "@effect/atom-react";
import {
  EnvironmentId as EnvironmentIdSchema,
  ModelSelection as ModelSelectionSchema,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_INPUT_CHARS,
  ProviderInteractionMode as ProviderInteractionModeSchema,
  RuntimeMode as RuntimeModeSchema,
  SkillId as SkillIdSchema,
  type EnvironmentId,
  type ModelSelection,
  type ProjectId,
  type ProviderInteractionMode,
  type RuntimeMode,
  type SkillId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect } from "react";
import { Atom } from "effect/unstable/reactivity";

import { removeStaleAtomicWriteTempFiles, writeFileAtomically } from "../lib/atomic-file";
import { PersistedComposerAttachmentSchema } from "../lib/composer-image-schema";
import {
  composerAttachmentFileReferenceKey,
  isComposerAttachmentFileRetained,
  retainComposerAttachmentFile,
} from "../lib/composerAttachmentFiles";
import type { DraftComposerAttachment, FileBackedComposerAttachment } from "../lib/composerImages";
import { SerializedAsyncQueue } from "../lib/serialized-async-queue";
import { appAtomRegistry } from "./atom-registry";
import {
  isNewTaskDraftKey,
  newTaskDraftKey,
  parseLegacyNewTaskDraftKey,
} from "./new-task-draft-key";
import {
  decodeQueuedThreadMessage,
  encodeQueuedThreadMessage,
  QueuedThreadMessageSchema,
  type QueuedThreadMessage,
} from "./thread-outbox-model";
import { flushThreadOutbox, threadOutboxManager } from "./thread-outbox";
import { composerDraftEnvironmentId } from "../lib/composerAttachmentUploadQueue";

const COMPOSER_DRAFTS_SCHEMA_VERSION = 1;
const COMPOSER_DRAFTS_DIRECTORY = "composer-drafts";
const COMPOSER_DRAFTS_FILE = "drafts.json";
const PERSIST_DEBOUNCE_MS = 200;

export class ComposerDraftPersistenceError extends Schema.TaggedErrorClass<ComposerDraftPersistenceError>()(
  "ComposerDraftPersistenceError",
  {
    operation: Schema.Literals(["open", "read", "decode", "encode", "write", "hydrate"]),
    directory: Schema.String,
    fileName: Schema.String,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Composer draft persistence operation ${this.operation} failed for ${this.directory}/${this.fileName}.`;
  }
}

export interface ComposerDraft {
  readonly text: string;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly importedShareIds?: ReadonlyArray<string>;
  readonly modelSelection?: ModelSelection;
  readonly runtimeMode?: RuntimeMode;
  readonly interactionMode?: ProviderInteractionMode;
  readonly workspaceSelection?: ComposerDraftWorkspaceSelection;
  /** Per-thread skill picks for the next Start; absent means none picked. */
  readonly enabledSkillIds?: ReadonlyArray<SkillId>;
  /**
   * Draft-scoped auto-PR override. Absent means "follow the per-mode
   * preference"; set when a queued task is hydrated for editing so its
   * captured choice survives preference changes.
   */
  readonly autoCreatePullRequest?: boolean;
  /**
   * Exact prompt the last pull-request hand-off wrote into this draft. Survives
   * persistence so a later hand-off can replace that sentence after restart.
   */
  readonly lastHandoffPrompt?: string;
  /**
   * Pull-request URL/reference from a hand-off. Start prepares that checkout
   * instead of using the draft's ordinary workspace selection.
   */
  readonly pullRequestReference?: string;
}

export interface ComposerDraftContent {
  readonly text: string;
  readonly attachments: ReadonlyArray<DraftComposerAttachment>;
  readonly sourceShareId?: string;
}

export interface ComposerDraftWorkspaceSelection {
  readonly mode: "local" | "worktree";
  readonly branch: string | null;
  readonly worktreePath: string | null;
  readonly startFromOrigin?: boolean;
}

export type ComposerDraftSettingsUpdate = Pick<
  ComposerDraft,
  | "modelSelection"
  | "runtimeMode"
  | "interactionMode"
  | "workspaceSelection"
  | "enabledSkillIds"
  | "autoCreatePullRequest"
>;

const ComposerDraftWorkspaceSelectionSchema = Schema.Struct({
  mode: Schema.Literals(["local", "worktree"]),
  branch: Schema.NullOr(Schema.String),
  worktreePath: Schema.NullOr(Schema.String),
  startFromOrigin: Schema.optional(Schema.Boolean),
});

const ComposerDraftProjectSchema = Schema.Struct({
  environmentId: EnvironmentIdSchema,
  projectId: ProjectIdSchema,
  createdAt: Schema.String,
});

const ComposerDraftSchema = Schema.Struct({
  text: Schema.String,
  attachments: Schema.Array(PersistedComposerAttachmentSchema),
  importedShareIds: Schema.optional(Schema.Array(Schema.String)),
  modelSelection: Schema.optional(ModelSelectionSchema),
  runtimeMode: Schema.optional(RuntimeModeSchema),
  interactionMode: Schema.optional(ProviderInteractionModeSchema),
  workspaceSelection: Schema.optional(ComposerDraftWorkspaceSelectionSchema),
  enabledSkillIds: Schema.optional(Schema.Array(SkillIdSchema)),
  autoCreatePullRequest: Schema.optional(Schema.Boolean),
  lastHandoffPrompt: Schema.optional(Schema.String),
  pullRequestReference: Schema.optional(Schema.String),
});

const PersistedComposerDraftsSchema = Schema.Struct({
  schemaVersion: Schema.Literal(COMPOSER_DRAFTS_SCHEMA_VERSION),
  drafts: Schema.Record(Schema.String, ComposerDraftSchema),
  stickyModelSelection: Schema.optional(ModelSelectionSchema),
  cloudAccountId: Schema.optional(Schema.String),
  signedOutDrafts: Schema.optional(
    Schema.Record(
      Schema.String,
      Schema.Struct({
        drafts: Schema.Record(Schema.String, ComposerDraftSchema),
        queuedMessages: Schema.Array(QueuedThreadMessageSchema),
      }),
    ),
  ),
});

const decodePersistedComposerDraftsDocument = Schema.decodeUnknownSync(
  PersistedComposerDraftsSchema,
);

const EMPTY_DRAFT: ComposerDraft = {
  text: "",
  attachments: [],
};

export const composerDraftsAtom = Atom.make<Record<string, ComposerDraft>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:composer-drafts"),
);

export const stickyComposerModelSelectionAtom = Atom.make<ModelSelection | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("mobile:sticky-composer-model-selection"),
);

interface SignedOutDrafts {
  readonly drafts: Record<string, ComposerDraft>;
  readonly queuedMessages: ReadonlyArray<QueuedThreadMessage>;
}

interface ComposerCloudDraftState {
  readonly accountId: string | null;
  readonly signedOut: Record<string, SignedOutDrafts>;
}

export const composerCloudDraftsAtom = Atom.make<ComposerCloudDraftState>({
  accountId: null,
  signedOut: {},
}).pipe(Atom.keepAlive);

let loadPromise: Promise<void> | null = null;
let draftsLoaded = false;
let lastLoadError: ComposerDraftPersistenceError | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
const persistenceQueue = new SerializedAsyncQueue();

/** Resets module-level state between test runs. */
export function resetComposerDraftsLoadState(): void {
  loadPromise = null;
  draftsLoaded = false;
  lastLoadError = null;
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = null;
}

function normalizeDraft(draft: ComposerDraft | undefined): ComposerDraft {
  if (!draft) {
    return EMPTY_DRAFT;
  }
  return {
    ...draft,
    text: limitComposerDraftText(draft.text),
    attachments: draft.attachments,
    ...(draft.lastHandoffPrompt === undefined
      ? {}
      : { lastHandoffPrompt: limitComposerDraftText(draft.lastHandoffPrompt) }),
  };
}

export function limitComposerDraftText(value: string): string {
  return value.length <= PROVIDER_SEND_TURN_MAX_INPUT_CHARS
    ? value
    : value.slice(0, PROVIDER_SEND_TURN_MAX_INPUT_CHARS);
}

export function composerDraftTextLimitMessage(): string {
  return `Messages can contain up to ${PROVIDER_SEND_TURN_MAX_INPUT_CHARS.toLocaleString("en-US")} characters.`;
}

export function getComposerDraftSnapshot(draftKey: string): ComposerDraft {
  return normalizeDraft(appAtomRegistry.get(composerDraftsAtom)[draftKey]);
}

export function isComposerDraftEmpty(draft: ComposerDraft): boolean {
  return isEmptyDraft(draft);
}

// The project stamp is identity, not content: a new-task draft with nothing
// else in it is still empty and gets dropped like any other.
function isEmptyDraft(draft: ComposerDraft): boolean {
  return (
    draft.text.length === 0 &&
    draft.attachments.length === 0 &&
    draft.modelSelection === undefined &&
    draft.runtimeMode === undefined &&
    draft.interactionMode === undefined &&
    draft.workspaceSelection === undefined &&
    draft.enabledSkillIds === undefined &&
    draft.autoCreatePullRequest === undefined &&
    draft.lastHandoffPrompt === undefined &&
    draft.pullRequestReference === undefined
  );
}

/**
 * Writes a draft back, dropping it once empty. A new-task draft keeps its
 * entry while the composer is bound to it (the project stamp is what the
 * composer binds to); the persist sweep still leaves empty ones off disk.
 */
function withComposerDraft(
  current: Record<string, ComposerDraft>,
  draftKey: string,
  draft: ComposerDraft,
): Record<string, ComposerDraft> {
  if (isEmptyDraft(draft) && draft.project === undefined) {
    const next = { ...current };
    delete next[draftKey];
    return next;
  }
  return { ...current, [draftKey]: draft };
}

export { isNewTaskDraftKey, newTaskDraftKey } from "./new-task-draft-key";

// Draft ids only need to be unique within this device's draft file. Deriving
// them from time plus randomness keeps this module free of native imports,
// which the persistence tests rely on.
function newDraftId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Project-keyed new-task drafts from earlier builds are rewritten on load into
 * id-keyed drafts with the project stamped in, so existing drafts survive the
 * switch to many-per-project.
 */
export function migrateLegacyNewTaskDraft(
  key: string,
  draft: ComposerDraft,
  now: string,
): readonly [key: string, draft: ComposerDraft] {
  const legacy = draft.project === undefined ? parseLegacyNewTaskDraftKey(key) : null;
  if (legacy === null) {
    return [key, draft];
  }
  return [
    newTaskDraftKey(newDraftId()),
    {
      ...draft,
      project: {
        environmentId: EnvironmentIdSchema.make(legacy.environmentId),
        projectId: ProjectIdSchema.make(legacy.projectId),
        createdAt: now,
      },
    },
  ];
}

export function decodePersistedComposerState(value: unknown): {
  readonly drafts: Record<string, ComposerDraft>;
  readonly stickyModelSelection: ModelSelection | null;
  readonly cloudDrafts: ComposerCloudDraftState;
} {
  const parsed = decodePersistedComposerDraftsDocument(value);
  const drafts = Object.fromEntries(
    Object.entries(parsed.drafts)
      .map(([draftKey, draft]): [string, ComposerDraft] => {
        const normalizedDraft: ComposerDraft = {
          ...draft,
          text: limitComposerDraftText(draft.text),
          ...(draft.lastHandoffPrompt === undefined
            ? {}
            : { lastHandoffPrompt: limitComposerDraftText(draft.lastHandoffPrompt) }),
          // Persisted drafts omit the payload; an empty dataUrl marks the
          // attachment for rehydration from its preview file on load.
          attachments: draft.attachments.map((attachment) =>
            attachment.type === "file" || attachment.fileUri
              ? attachment
              : {
                  ...attachment,
                  dataUrl: attachment.dataUrl ?? "",
                },
          ),
        };
        const nextDraft =
          // Stale new-task drafts left on disk by builds before the
          // model-precedence fix carry a bare modelSelection with no
          // other selector settings. Strip it so the next compose pass
          // re-resolves project → sticky → provider defaults. Drafts
          // with runtime/interaction/workspace settings or actual text /
          // attachments were deliberately configured and are left alone.
          draftKey.startsWith("new-task:") &&
          normalizedDraft.modelSelection &&
          normalizedDraft.text.length === 0 &&
          normalizedDraft.attachments.length === 0 &&
          normalizedDraft.runtimeMode === undefined &&
          normalizedDraft.interactionMode === undefined &&
          normalizedDraft.workspaceSelection === undefined
            ? { ...normalizedDraft, modelSelection: undefined }
            : normalizedDraft;
        return [draftKey, nextDraft];
      })
      .filter(([, draft]) => shouldRetainPersistedDraft(draft)),
  );
  return {
    drafts,
    stickyModelSelection: parsed.stickyModelSelection ?? null,
    cloudDrafts: {
      accountId: parsed.cloudAccountId ?? null,
      signedOut: Object.fromEntries(
        Object.entries(parsed.signedOutDrafts ?? {}).map(([id, saved]) => [
          id,
          {
            // Archived drafts come back through restoreCloudComposerDrafts
            // without another decode, so they get the same key migration.
            drafts: Object.fromEntries(
              Object.entries(saved.drafts).map(([key, draft]) =>
                migrateLegacyNewTaskDraft(key, draft, now),
              ),
            ),
            queuedMessages: saved.queuedMessages.map(decodeQueuedThreadMessage),
          },
        ]),
      ),
    },
  };
}

export function decodePersistedComposerDrafts(value: unknown): Record<string, ComposerDraft> {
  return decodePersistedComposerState(value).drafts;
}

function shouldRetainPersistedDraft(draft: ComposerDraft): boolean {
  // importedShareIds are share-import receipts: a contentless draft carrying
  // one must survive, or the same native share would be imported again.
  return !isEmptyDraft(draft) || (draft.importedShareIds?.length ?? 0) > 0;
}

type PersistedComposerDraft = Omit<ComposerDraft, "attachments"> & {
  readonly attachments: ReadonlyArray<
    | (Omit<DraftComposerImageAttachment, "dataUrl"> & { readonly dataUrl?: string })
    | DraftComposerFileAttachment
  >;
};

/**
 * The whole drafts record is rewritten on every debounced keystroke, so the
 * persisted document must stay small: image payloads live in app-owned
 * preview files and only their URIs are persisted.
 */
export function encodePersistedComposerDrafts(
  drafts: Record<string, ComposerDraft>,
): Record<string, PersistedComposerDraft> {
  return Object.fromEntries(
    Object.entries(drafts)
      .filter(([, draft]) => shouldRetainPersistedDraft(draft))
      .map(([draftKey, draft]): [string, PersistedComposerDraft] => [
        draftKey,
        {
          ...normalizeDraft(draft),
          attachments: draft.attachments.map((attachment) => {
            if (
              attachment.type === "file" ||
              attachment.fileUri ||
              !isOwnedComposerPreviewUri(attachment.previewUri)
            )
              return attachment;
            const { dataUrl: _dataUrl, ...persisted } = attachment;
            return persisted;
          }),
        },
      ]),
  );
}

    ...retained
  } = existing;
  // The auto-PR override travels with the workspace selection: both describe
  // this task's picks, so the next task re-resolves from defaults. Hand-off
  // ownership and its checkout reference leave with the cleared prompt text.
  const draft = {
    ...retained,
    ...(options?.clearModelSelection || modelSelection === undefined ? {} : { modelSelection }),
    ...(options?.clearWorkspaceSelection || workspaceSelection === undefined
      ? {}
      : { workspaceSelection }),
    ...(options?.clearWorkspaceSelection || autoCreatePullRequest === undefined
      ? {}
      : { autoCreatePullRequest }),
    text: "",
    attachments: [],
  };
  if (isEmptyDraft(draft)) {
    const next = { ...current };
    delete next[draftKey];
    return next;
  }
  return {
    ...current,
    [draftKey]: draft,
  };
}

export function restoreComposerDraftSnapshotState(
  current: Record<string, ComposerDraft>,
  draftKey: string,
  snapshot: ComposerDraft,
): Record<string, ComposerDraft> {
  const next = { ...current };
  if (isEmptyDraft(snapshot)) {
    delete next[draftKey];
  } else {
    next[draftKey] = normalizeDraft(snapshot);
  }
  return next;
}

export function copyComposerDraftContentState(
  current: Record<string, ComposerDraft>,
  sourceDraftKey: string,
  targetDraftKey: string,
): Record<string, ComposerDraft> {
  if (sourceDraftKey === targetDraftKey) {
    return current;
  }
  const source = normalizeDraft(current[sourceDraftKey]);
  const target = normalizeDraft(current[targetDraftKey]);
  const sourceHasContent =
    source.text.length > 0 ||
    source.attachments.length > 0 ||
    (source.importedShareIds?.length ?? 0) > 0;
  const targetHasContent =
    target.text.length > 0 ||
    target.attachments.length > 0 ||
    (target.importedShareIds?.length ?? 0) > 0;
  if (!sourceHasContent || targetHasContent) {
    return current;
  }
  return {
    ...current,
    [targetDraftKey]: {
      ...target,
      text: source.text,
      attachments: source.attachments,
      ...(source.importedShareIds ? { importedShareIds: source.importedShareIds } : {}),
    },
  };
}

export async function copyComposerDraftContentIfEmpty(
  sourceDraftKey: string,
  targetDraftKey: string,
): Promise<void> {
  await requireComposerDraftsLoaded();
  updateComposerDrafts((current) =>
    copyComposerDraftContentState(current, sourceDraftKey, targetDraftKey),
  );
}

function mergeComposerDraftText(existing: string, incoming: string): string {
  const boundedExisting = limitComposerDraftText(existing);
  const boundedIncoming = limitComposerDraftText(incoming);
  if (boundedIncoming.length === 0) {
    return boundedExisting;
  }
  if (boundedExisting.length === 0) {
    return boundedIncoming;
  }
  // Import retries are possible after an interrupted native handoff. Keep the
  // operation idempotent when the same shared text is already present.
  if (boundedExisting === boundedIncoming || boundedExisting.endsWith(`\n\n${boundedIncoming}`)) {
    return boundedExisting;
  }
  const separator = "\n\n";
  const remaining = PROVIDER_SEND_TURN_MAX_INPUT_CHARS - boundedExisting.length - separator.length;
  if (remaining <= 0) {
    return boundedExisting;
  }
  return `${boundedExisting}${separator}${boundedIncoming.slice(0, remaining)}`;
}

export function mergeComposerDraftContentState(
  current: Record<string, ComposerDraft>,
  draftKey: string,
  content: ComposerDraftContent,
): Record<string, ComposerDraft> {
  const existing = normalizeDraft(current[draftKey]);
  if (content.sourceShareId && existing.importedShareIds?.includes(content.sourceShareId)) {
    return current;
  }
  const attachmentIds = new Set(existing.attachments.map((attachment) => attachment.id));
  const incomingAttachments = content.attachments.filter((attachment) => {
    if (attachmentIds.has(attachment.id)) {
      return false;
    }
    attachmentIds.add(attachment.id);
    return true;
  });
  const attachments = [...existing.attachments, ...incomingAttachments].slice(
    0,
    PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  );
  const text = mergeComposerDraftText(existing.text, content.text);
  const importedShareIds = content.sourceShareId
    ? [...(existing.importedShareIds ?? []), content.sourceShareId]
    : existing.importedShareIds;
  if (
    text === existing.text &&
    attachments.length === existing.attachments.length &&
    importedShareIds === existing.importedShareIds
  ) {
    return current;
  }
  return {
    ...current,
    [draftKey]: {
      ...existing,
      text,
      attachments,
      ...(importedShareIds ? { importedShareIds } : {}),
    },
  };
}

/**
 * Atomically moves an incoming share into a project-scoped composer draft.
 * The durable write happens before the share inbox item can be acknowledged.
 */
export async function mergeComposerDraftContent(
  draftKey: string,
  content: ComposerDraftContent,
): Promise<{
  readonly skippedAttachmentCount: number;
  readonly skippedAttachments: ReadonlyArray<DraftComposerAttachment>;
}> {
  await requireComposerDraftsLoaded();
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const current = appAtomRegistry.get(composerDraftsAtom);
  const next = mergeComposerDraftContentState(current, draftKey, content);
  const currentAttachmentIds = new Set(
    normalizeDraft(current[draftKey]).attachments.map((attachment) => attachment.id),
  );
  const nextAttachmentIds = new Set(
    normalizeDraft(next[draftKey]).attachments.map((attachment) => attachment.id),
  );
  const skippedAttachments = content.attachments.filter(
    (attachment) =>
      !currentAttachmentIds.has(attachment.id) && !nextAttachmentIds.has(attachment.id),
  );
  // Publish the content and its import receipt together before the filesystem
  // await. Typing during persistence then builds on the receipt-bearing state,
  // and its debounced write is serialized after this transaction.
  if (next !== current) {
    appAtomRegistry.set(composerDraftsAtom, next);
  }
  await persistenceQueue.run(() =>
    writePersistedComposerState(next, appAtomRegistry.get(stickyComposerModelSelectionAtom)),
  );
  return { skippedAttachmentCount: skippedAttachments.length, skippedAttachments };
}

/** Restores the exact content/settings captured before an interrupted import. */
export async function restoreComposerDraftSnapshot(
  draftKey: string,
  snapshot: ComposerDraft,
): Promise<void> {
  await requireComposerDraftsLoaded();
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const next = restoreComposerDraftSnapshotState(
    appAtomRegistry.get(composerDraftsAtom),
    draftKey,
    snapshot,
  );
  appAtomRegistry.set(composerDraftsAtom, next);
  await persistenceQueue.run(() =>
    writePersistedComposerState(next, appAtomRegistry.get(stickyComposerModelSelectionAtom)),
  );
}

export function sameComposerDraftState(a: ComposerDraft, b: ComposerDraft): boolean {
  return (
    a.text === b.text &&
    a.attachments === b.attachments &&
    a.importedShareIds === b.importedShareIds &&
    a.modelSelection === b.modelSelection &&
    a.runtimeMode === b.runtimeMode &&
    a.interactionMode === b.interactionMode &&
    a.workspaceSelection === b.workspaceSelection
  );
}

/**
 * Undoes an abandoned mergeComposerDraftContent. When the draft is untouched
 * since `merged` (the state captured right after the merge), the pre-merge
 * snapshot comes back exactly. When the user edited the draft during the
 * merge's awaits, only what the merge inserted (the appended text and the new
 * attachments) is taken back out, so the user's edits survive the rollback.
 */
export function undoComposerDraftMergeState(
  current: Record<string, ComposerDraft>,
  draftKey: string,
  snapshot: ComposerDraft,
  merged: ComposerDraft,
): Record<string, ComposerDraft> {
  const existing = normalizeDraft(current[draftKey]);
  if (sameComposerDraftState(existing, merged)) {
    return restoreComposerDraftSnapshotState(current, draftKey, snapshot);
  }
  const insertedText = merged.text.startsWith(snapshot.text)
    ? merged.text.slice(snapshot.text.length)
    : "";
  const snapshotAttachmentIds = new Set(snapshot.attachments.map((attachment) => attachment.id));
  const insertedAttachmentIds = new Set(
    merged.attachments
      .filter((attachment) => !snapshotAttachmentIds.has(attachment.id))
      .map((attachment) => attachment.id),
  );
  // A setting still holding the merge's value is the merge's doing: restore
  // the snapshot's. One the user changed since the merge stays theirs.
  const undoSetting = <
    K extends "modelSelection" | "runtimeMode" | "interactionMode" | "workspaceSelection",
  >(
    key: K,
  ): ComposerDraft[K] => (existing[key] === merged[key] ? snapshot[key] : existing[key]);
  const text =
    insertedText.length > 0 && existing.text.startsWith(merged.text)
      ? snapshot.text + existing.text.slice(merged.text.length)
      : insertedText.length > 0 && existing.text.endsWith(insertedText)
        ? existing.text.slice(0, existing.text.length - insertedText.length)
        : existing.text;
  const draft = {
    ...existing,
    text,
    attachments: existing.attachments.filter(
      (attachment) => !insertedAttachmentIds.has(attachment.id),
    ),
    modelSelection: undoSetting("modelSelection"),
    runtimeMode: undoSetting("runtimeMode"),
    interactionMode: undoSetting("interactionMode"),
    workspaceSelection: undoSetting("workspaceSelection"),
  };
  return withComposerDraft(current, draftKey, draft);
}

/** Applies undoComposerDraftMergeState and lands it durably. */
export async function undoComposerDraftMerge(
  draftKey: string,
  snapshot: ComposerDraft,
  merged: ComposerDraft,
): Promise<void> {
  ensureComposerDraftsLoaded();
  if (loadPromise !== null) {
    await loadPromise;
  }
  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  const next = undoComposerDraftMergeState(
    appAtomRegistry.get(composerDraftsAtom),
    draftKey,
    snapshot,
    merged,
  );
  appAtomRegistry.set(composerDraftsAtom, next);
  await persistenceQueue.run(() =>
    writePersistedComposerState(next, appAtomRegistry.get(stickyComposerModelSelectionAtom)),
  );
}

export function clearComposerDraftContent(
  draftKey: string,
  options?: {
    readonly clearModelSelection?: boolean;
    readonly clearWorkspaceSelection?: boolean;
    // Send clears the draft while the durable outbox write is still in
    // flight. Sweeping then would race the write: a failed enqueue rolls the
    // message out of the queue mid-sweep and its files get deleted right
    // before the failure handler restores them. The sender re-schedules
    // cleanup once the write settles.
    readonly deferAttachmentCleanup?: boolean;
  },
): void {
  const previousAttachments = getComposerDraftSnapshot(draftKey).attachments;
  updateComposerDrafts((current) => clearComposerDraftContentState(current, draftKey, options));
  if (!options?.deferAttachmentCleanup) {
    scheduleUnusedComposerAttachmentCleanup(previousAttachments);
  }
}

export function clearComposerDraft(
  draftKey: string,
  options?: { readonly deferAttachmentCleanup?: boolean },
): void {
  const previousAttachments = getComposerDraftSnapshot(draftKey).attachments;
  updateComposerDrafts((current) => {
    if (!current[draftKey]) {
      return current;
    }
    const next = { ...current };
    delete next[draftKey];
    return next;
  });
  if (!options?.deferAttachmentCleanup) {
    scheduleUnusedComposerAttachmentCleanup(previousAttachments);
  }
}

export function removeComposerDraftsForEnvironment(
  drafts: Record<string, ComposerDraft>,
  environmentId: EnvironmentId,
): Record<string, ComposerDraft> {
  const environmentPrefix = `${environmentId}:`;
  return Object.fromEntries(
    Object.entries(drafts).filter(
      ([draftKey, draft]) =>
        !draftKey.startsWith(environmentPrefix) && draft.project?.environmentId !== environmentId,
    ),
  );
}

/**
 * Mints a new-task draft for a project. The entry is published immediately so
 * the composer can bind to its key before the user types; it stays out of the
 * list until it has content, and the empty-draft sweep drops it on persist if
 * nothing is ever written.
 */
export function createNewTaskDraft(project: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}): string {
  const draftKey = newTaskDraftKey(newDraftId());
  const stamp: ComposerDraftProject = {
    environmentId: project.environmentId,
    projectId: project.projectId,
    createdAt: new Date().toISOString(),
  };
  updateComposerDrafts((current) => ({
    ...current,
    [draftKey]: { ...EMPTY_DRAFT, project: stamp },
  }));
  return draftKey;
}

/**
 * Points an existing new-task draft at a different project, keeping its
 * content and identity. Workspace selection is project-specific (branch,
 * worktree), so it is cleared; model and mode choices carry over.
 */
export function retargetNewTaskDraft(
  draftKey: string,
  project: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
): void {
  updateComposerDrafts((current) => {
    const existing = current[draftKey];
    const stamp = existing?.project;
    if (
      stamp !== undefined &&
      stamp.environmentId === project.environmentId &&
      stamp.projectId === project.projectId
    ) {
      return current;
    }
    const { workspaceSelection: _workspaceSelection, ...retained } = normalizeDraft(existing);
    // Pending uploads live on one server. Crossing environments keeps the
    // local bytes (the upload worker re-sends them to the new environment)
    // but drops the old stamp, so it cannot pin the source environment's
    // pending upload alive from the moved draft.
    const attachments = retained.attachments.map((attachment) =>
      attachment.uploadEnvironmentId !== undefined &&
      attachment.uploadEnvironmentId !== project.environmentId
        ? stripAttachmentUploadReference(attachment)
        : attachment,
    );
    return {
      ...current,
      [draftKey]: {
        ...retained,
        attachments,
        project: {
          environmentId: project.environmentId,
          projectId: project.projectId,
          createdAt: stamp?.createdAt ?? new Date().toISOString(),
        },
      },
    };
  });
}

/** New-task drafts for a project, newest first. */
export function findNewTaskDraftKeys(
  drafts: Readonly<Record<string, ComposerDraft>>,
  project: { readonly environmentId: EnvironmentId; readonly projectId: ProjectId },
): ReadonlyArray<string> {
  return Object.entries(drafts)
    .filter(
      ([key, draft]) =>
        isNewTaskDraftKey(key) &&
        draft.project?.environmentId === project.environmentId &&
        draft.project.projectId === project.projectId,
    )
    .sort(([, left], [, right]) =>
      (right.project?.createdAt ?? "").localeCompare(left.project?.createdAt ?? ""),
    )
    .map(([key]) => key);
}

export async function clearComposerDraftsEnvironment(environmentId: EnvironmentId): Promise<void> {
  await requireComposerDraftsLoaded();

  const current = appAtomRegistry.get(composerDraftsAtom);
  const next = removeComposerDraftsForEnvironment(current, environmentId);
  const removedAttachments = Object.entries(current)
    .filter(([draftKey]) => next[draftKey] === undefined)
    .flatMap(([, draft]) => draft.attachments);

  if (persistTimer !== null) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  appAtomRegistry.set(composerDraftsAtom, next);
  await persistenceQueue.run(() =>
    writePersistedComposerState(next, appAtomRegistry.get(stickyComposerModelSelectionAtom)),
  );
  await releaseUnusedComposerAttachmentFiles(removedAttachments);
}

export function useComposerDraft(draftKey: string | null): ComposerDraft {
  const drafts = useAtomValue(composerDraftsAtom);
  useEffect(() => {
    void ensureComposerDraftsLoaded();
  }, []);
  return draftKey ? normalizeDraft(drafts[draftKey]) : EMPTY_DRAFT;
}

export function useStickyComposerModelSelection(): ModelSelection | null {
  const selection = useAtomValue(stickyComposerModelSelectionAtom);
  useEffect(() => {
    ensureComposerDraftsLoaded();
  }, []);
  return selection;
}
