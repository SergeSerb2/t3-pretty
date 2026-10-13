import { AuthFilesystemReadScope } from "@t3tools/contracts";
import { readEnvironmentScope } from "../../state/session";
import { executeAtomQuery } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import {
  isWorkspaceBrowserPreviewPath,
  isWorkspaceImagePreviewPath,
} from "@t3tools/shared/filePreview";

import { appAtomRegistry } from "../../state/atom-registry";
import { projectEnvironment } from "../../state/projects";
import { isVideoPreviewFile } from "./filePath";
import { prepareSourceFileDocument } from "./source-file-document";
import { sourceHighlightAtom } from "./sourceHighlightingState";
import type { ReviewDiffTheme } from "../review/shikiReviewHighlighter";

const inFlightPreloads = new Map<string, Promise<void>>();
const MAX_IN_FLIGHT_PRELOADS = 4;
const MAX_HIGHLIGHT_PRELOAD_CHARACTERS = 256 * 1024;
const MAX_SOURCE_PRELOAD_LINES = 2_000;

function shouldPrepareSourcePreload(contents: string): boolean {
  if (contents.length > MAX_HIGHLIGHT_PRELOAD_CHARACTERS) return false;
  const newlines = /\r\n?|\n/g;
  let lines = 1;
  while (newlines.exec(contents) !== null) {
    if (++lines > MAX_SOURCE_PRELOAD_LINES) return false;
  }
  return true;
}

function preloadKey(input: {
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly relativePath: string;
}): string {
  return JSON.stringify([input.environmentId, input.cwd, input.relativePath]);
}

export function preloadWorkspaceFileContents(input: {
  readonly cwd: string;
  readonly environmentId: EnvironmentId;
  readonly relativePath: string;
  readonly theme: ReviewDiffTheme;
}): void {
  if (
    !readEnvironmentScope(input.environmentId, AuthFilesystemReadScope) ||
    isWorkspaceBrowserPreviewPath(input.relativePath) ||
    isWorkspaceImagePreviewPath(input.relativePath) ||
    isVideoPreviewFile(input.relativePath)
  ) {
    return;
  }

  const key = preloadKey(input);
  if (inFlightPreloads.has(key) || inFlightPreloads.size >= MAX_IN_FLIGHT_PRELOADS) {
    return;
  }

  const preload = (async () => {
    const result = await executeAtomQuery(
      appAtomRegistry,
      projectEnvironment.readFile({
        environmentId: input.environmentId,
        input: { cwd: input.cwd, relativePath: input.relativePath },
      }),
      {
        label: "workspace file preload",
        reportDefect: false,
        reportFailure: false,
      },
    );
    if (result._tag !== "Success") {
      return;
    }

    // Rows and their JSON can dwarf the original text. Bound speculative work
    // before constructing them; the visible file surface still opens every file.
    if (!shouldPrepareSourcePreload(result.value.contents)) return;
    const document = prepareSourceFileDocument(result.value.contents);
    await executeAtomQuery(
      appAtomRegistry,
      sourceHighlightAtom({
        path: input.relativePath,
        contents: document.contents,
        theme: input.theme,
      }),
      {
        label: "workspace source highlight preload",
        reportDefect: false,
        reportFailure: false,
      },
    );
  })()
    .catch(() => {
      // Preloading is opportunistic. The authoritative file surface owns
      // diagnostics and retry UI when the user actually opens the file.
    })
    .finally(() => {
      inFlightPreloads.delete(key);
    });

  inFlightPreloads.set(key, preload);
}
