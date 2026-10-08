import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ProjectService from "../../../project/ProjectService.ts";

import * as HtmlRender from "../../../htmlRender/HtmlRender.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { readCaller, readMutationCaller, unavailable, type Caller } from "../../threadAccess.ts";
import { HtmlPreviewToolkit, HtmlRenderToolkit, type HtmlToolkit } from "./tools.ts";

const INVALID_PAGE_ERRORS = new Set([
  "HtmlRenderImagesNotFoundError",
  "HtmlRenderImageTooLargeError",
  "HtmlRenderPageTooLargeError",
]);

// Every HTML render error message is built on the server and tells the agent what to do next.
const toFailure = (error: { readonly _tag: string; readonly message: string }) =>
  new OrchestratorMcpFailure({
    code: INVALID_PAGE_ERRORS.has(error._tag) ? "invalid_request" : "orchestration_error",
    message: error.message,
  });

const imageRootsFor = Effect.fn("html.imageRootsFor")(function* ({ caller }: Caller) {
  if (caller === undefined) return [];
  const projects = yield* ProjectService.ProjectService;
  const project = yield* projects.getById(caller.projectId).pipe(Effect.mapError(unavailable));
  // A worktree is the caller's workspace; it does not grant access to another checkout.
  return caller.worktreePath !== null
    ? [caller.worktreePath]
    : Option.isSome(project)
      ? [project.value.workspaceRoot]
      : [];
});

const handlers = {
  // The headless browser runs on the host and can open local files, so only
  // agents T3 launched, which already work on this machine, get it.
  html_preview: McpToolAccess.readsAsCaller((input) =>
    Effect.gen(function* () {
      const htmlRender = yield* HtmlRender.HtmlRender;
      const imageRoots = yield* imageRootsFor(yield* readCaller());
      const { png, ...preview } = yield* htmlRender
        .preview({ ...input, imageRoots })
        .pipe(Effect.mapError(toFailure));
      return {
        ...preview,
        screenshot: {
          mimeType: "image/png" as const,
          data: png,
          width: preview.width,
          height: preview.capturedHeight,
        },
      };
    }),
  ),
  // The page is stored in the calling thread, so it needs that thread's live run.
  html_render: McpToolAccess.actsAsCaller((input) =>
    Effect.gen(function* () {
      // The page is stored in the calling thread, so it needs that thread's
      // live run, like any other write.
      const caller = yield* readMutationCaller();
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const imageRoots = yield* imageRootsFor(caller);
      const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "html_render");
      const htmlRender = yield* HtmlRender.HtmlRender;
      const reference = yield* htmlRender
        .publish({ threadId: thread.threadId, ...input, imageRoots })
        .pipe(Effect.mapError(toFailure));
      return {
        htmlRender: reference,
        message:
          "Shown to the reader above your reply. Don't mention or describe the page; reply with only what it doesn't already say.",
      };
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof HtmlToolkit.tools>;

export const layerPreview = McpToolAccess.toLayer(HtmlPreviewToolkit, {
  html_preview: handlers.html_preview,
});

export const layerRender = McpToolAccess.toLayer(HtmlRenderToolkit, {
  html_render: handlers.html_render,
});
