import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_TEXT_GENERATION_MODEL,
  ProviderDriverKind,
  type ModelSelection,
  type OrchestrationProjectShell,
  type ProjectId,
} from "@t3tools/contracts";
import { projectNeedsGeneratedIcon } from "@t3tools/shared/imageTool";
import { makeKeyedCoalescingWorker } from "@t3tools/shared/KeyedCoalescingWorker";
import { createModelSelection } from "@t3tools/shared/model";
import { isWorkspaceImagePreviewPath } from "@t3tools/shared/filePreview";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Encoding from "effect/Encoding";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Ref from "effect/Ref";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import { IMAGE_EXTENSION_BY_MIME_TYPE } from "../imageMime.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import type { ProviderInstance } from "../provider/ProviderDriver.ts";
import * as ProviderInstanceRegistry from "../provider/Services/ProviderInstanceRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { TextGeneration } from "../textGeneration/TextGeneration.ts";
import { importProjectFavicon } from "./ProjectFaviconStore.ts";

const GENERATED_ICON_FILE_NAME = ".t3-generated-project-icon.png";

export class ProjectIconReactor extends Context.Service<
  ProjectIconReactor,
  {
    readonly start: () => Effect.Effect<void, never, Scope.Scope>;
  }
>()("t3/project/ProjectIconReactor") {}

function isImageCapableDriver(driver: ProviderDriverKind): boolean {
  return driver === "grok" || driver === "codex";
}

function mimeTypeForPath(filePath: string): string {
  const extension = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  for (const [mimeType, mimeExtension] of Object.entries(IMAGE_EXTENSION_BY_MIME_TYPE)) {
    if (mimeExtension === extension) {
      return mimeType;
    }
  }
  return "image/png";
}

function pickImageCapableSelection(
  instances: ReadonlyArray<ProviderInstance>,
  preferred: ModelSelection,
): ModelSelection | null {
  const preferredInstance = instances.find(
    (instance) => instance.instanceId === preferred.instanceId && instance.enabled,
  );
  if (preferredInstance && isImageCapableDriver(preferredInstance.driverKind)) {
    return preferred;
  }
  const picked =
    instances.find((instance) => instance.enabled && instance.driverKind === "grok") ??
    instances.find((instance) => instance.enabled && instance.driverKind === "codex");
  if (!picked) {
    return null;
  }
  return createModelSelection(
    picked.instanceId,
    DEFAULT_MODEL_BY_PROVIDER[picked.driverKind] ?? DEFAULT_TEXT_GENERATION_MODEL,
  );
}

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettingsService;
  const projection = yield* ProjectionSnapshotQuery;
  const textGeneration = yield* TextGeneration;
  const registry = yield* ProviderInstanceRegistry.ProviderInstanceRegistry;
  const orchestrationEngine = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const enabledRef = yield* Ref.make(false);

  const processProject = Effect.fn("ProjectIconReactor.processProject")(function* (
    projectId: ProjectId,
  ) {
    const settings = yield* settingsService.getSettings.pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("project icon generation could not read settings", {
          projectId,
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(null)),
      ),
    );
    if (!settings) {
      return;
    }
    if (!settings.autoGenerateProjectIcons) {
      return;
    }
    const projectOption = yield* projection.getProjectShellById(projectId).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("project icon generation could not load project", {
          projectId,
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(Option.none())),
      ),
    );
    if (Option.isNone(projectOption)) {
      return;
    }
    const project: OrchestrationProjectShell = projectOption.value;
    if (!projectNeedsGeneratedIcon(project.faviconPath)) {
      return;
    }
    const instances = yield* registry.listInstances;
    const modelSelection = pickImageCapableSelection(
      instances,
      settings.textGenerationModelSelection,
    );
    if (!modelSelection) {
      yield* Effect.logDebug("project icon generation skipped: no Grok or Codex instance", {
        projectId,
      });
      return;
    }

    const outputPath = path.join(project.workspaceRoot, GENERATED_ICON_FILE_NAME);
    const generated = yield* textGeneration
      .generateProjectIcon({
        cwd: project.workspaceRoot,
        projectTitle: project.title,
        outputPath,
        modelSelection,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("project icon generation failed", {
            projectId,
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(null)),
        ),
      );
    if (!generated) {
      return;
    }
    const candidatePath = generated.path.trim().length > 0 ? generated.path.trim() : outputPath;
    if (!isWorkspaceImagePreviewPath(candidatePath)) {
      yield* Effect.logWarning("project icon generation returned a non-image path", {
        projectId,
        path: candidatePath,
      });
      return;
    }
    const bytes = yield* fileSystem.readFile(candidatePath).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("project icon generation could not read output", {
          projectId,
          path: candidatePath,
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(null)),
      ),
    );
    if (!bytes) {
      return;
    }
    const dataUrl = `data:${mimeTypeForPath(candidatePath)};base64,${Encoding.encodeBase64(bytes)}`;
    const imported = yield* importProjectFavicon({
      projectId,
      fileName: "icon.png",
      dataUrl,
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("project icon import failed", {
          projectId,
          cause: Cause.pretty(cause),
        }).pipe(Effect.as(null)),
      ),
    );
    if (!imported) {
      return;
    }
    const commandId = yield* crypto.randomUUIDv4.pipe(
      Effect.map((uuid) => CommandId.make(`server:project-icon:${uuid}`)),
    );
    yield* orchestrationEngine
      .dispatch({
        type: "project.meta.update",
        commandId,
        projectId,
        faviconPath: imported.faviconPath,
      })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("project icon update failed", {
            projectId,
            cause: Cause.pretty(cause),
          }),
        ),
      );
    yield* fileSystem.remove(candidatePath).pipe(Effect.catchCause(() => Effect.void));
    if (candidatePath !== outputPath) {
      yield* fileSystem.remove(outputPath).pipe(Effect.catchCause(() => Effect.void));
    }
  });

  const worker = yield* makeKeyedCoalescingWorker({
    merge: (_current: true, _next: true): true => true,
    process: (projectId: ProjectId, _value: true) =>
      processProject(projectId).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("project icon generation failed", {
            projectId,
            cause: Cause.pretty(cause),
          }),
        ),
      ),
  });

  const enqueueEligibleProjects = Effect.fn("ProjectIconReactor.enqueueEligibleProjects")(
    function* () {
      const snapshot = yield* projection.getShellSnapshot().pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("project icon backfill could not list projects", {
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(null)),
        ),
      );
      if (!snapshot) {
        return;
      }
      for (const project of snapshot.projects) {
        if (projectNeedsGeneratedIcon(project.faviconPath)) {
          yield* worker.enqueue(project.id, true);
        }
      }
    },
  );

  const start: ProjectIconReactor["Service"]["start"] = Effect.fn("ProjectIconReactor.start")(
    function* () {
      const initial = yield* settingsService.getSettings.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("project icon reactor could not read settings", {
            cause: Cause.pretty(cause),
          }).pipe(Effect.as(null)),
        ),
      );
      yield* Ref.set(enabledRef, initial?.autoGenerateProjectIcons === true);
      if (initial?.autoGenerateProjectIcons) {
        yield* enqueueEligibleProjects().pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("project icon backfill failed", { cause: Cause.pretty(cause) }),
          ),
        );
      }

      yield* forkParked(
        Stream.runForEach(orchestrationEngine.streamDomainEvents, (event) => {
          if (event.type !== "project.created") {
            return Effect.void;
          }
          return Ref.get(enabledRef).pipe(
            Effect.flatMap((enabled) =>
              enabled ? worker.enqueue(event.payload.projectId, true) : Effect.void,
            ),
          );
        }),
      );

      yield* forkParked(
        Stream.runForEach(settingsService.streamChanges, (next) =>
          Ref.get(enabledRef).pipe(
            Effect.flatMap((wasEnabled) =>
              Effect.gen(function* () {
                yield* Ref.set(enabledRef, next.autoGenerateProjectIcons);
                if (next.autoGenerateProjectIcons && !wasEnabled) {
                  yield* enqueueEligibleProjects().pipe(
                    Effect.catchCause((cause) =>
                      Effect.logWarning("project icon backfill failed", {
                        cause: Cause.pretty(cause),
                      }),
                    ),
                  );
                }
              }),
            ),
          ),
        ),
      );
    },
  );

  return ProjectIconReactor.of({ start });
});

export const layer = Layer.effect(ProjectIconReactor, make);
