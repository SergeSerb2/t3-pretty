import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import { Atom } from "effect/unstable/reactivity";

const WORKSPACE_IMAGE_IDLE_TTL_MS = 30 * 60_000;
const WORKSPACE_IMAGE_PREFETCH_TIMEOUT_MS = 30_000;

type ImagePrefetch = (uri: string) => Promise<boolean>;

class WorkspaceImageCacheKey extends Data.Class<{ readonly uri: string }> {}

export class WorkspaceImagePrefetchError extends Data.TaggedError("WorkspaceImagePrefetchError")<{
  readonly cause?: unknown;
  readonly uri: string;
}> {}

async function prefetchWithNativeImage(uri: string): Promise<boolean> {
  const { Image } = await import("react-native");
  return Image.prefetch(uri);
}

async function prefetchWithDeadline(
  prefetch: ImagePrefetch,
  uri: string,
  timeoutMs: number,
): Promise<boolean> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      prefetch(uri),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`Image prefetch timed out after ${timeoutMs} ms.`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== null) {
      clearTimeout(timeout);
    }
  }
}

export function createWorkspaceFileImageAtomFamily(options?: {
  readonly idleTtlMs?: number;
  readonly prefetch?: ImagePrefetch;
  readonly prefetchTimeoutMs?: number;
}) {
  const idleTtlMs = options?.idleTtlMs ?? WORKSPACE_IMAGE_IDLE_TTL_MS;
  const prefetch = options?.prefetch ?? prefetchWithNativeImage;
  const prefetchTimeoutMs = options?.prefetchTimeoutMs ?? WORKSPACE_IMAGE_PREFETCH_TIMEOUT_MS;
  const family = Atom.family((key: WorkspaceImageCacheKey) =>
    Atom.make(
      Effect.tryPromise({
        try: async () => {
          const cached = await prefetchWithDeadline(prefetch, key.uri, prefetchTimeoutMs);
          if (!cached) {
            throw new WorkspaceImagePrefetchError({ uri: key.uri });
          }
          return key.uri;
        },
        catch: (cause) =>
          cause instanceof WorkspaceImagePrefetchError
            ? cause
            : new WorkspaceImagePrefetchError({ uri: key.uri, cause }),
      }),
    ).pipe(Atom.setIdleTTL(idleTtlMs), Atom.withLabel(`mobile:workspace-image:${key.uri}`)),
  );

  return (uri: string) => family(new WorkspaceImageCacheKey({ uri }));
}

export const workspaceFileImageAtom = createWorkspaceFileImageAtomFamily();
