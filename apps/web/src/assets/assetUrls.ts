import { useAtomValue } from "@effect/atom-react";
import { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useMemo } from "react";

import { assetEnvironment } from "~/state/assets";
import { usePreparedConnection } from "~/state/session";

export { resolveAssetUrl } from "@t3tools/client-runtime/state/assets";

export type AssetUrlState =
  | { readonly _tag: "Loading" }
  | { readonly _tag: "Failure" }
  | { readonly _tag: "Success"; readonly url: string; readonly sourcePath?: string };

export function useAssetUrlState(
  environmentId: EnvironmentId,
  resource: AssetResource,
): AssetUrlState {
  const preparedConnection = usePreparedConnection(environmentId);
  const result = useAtomValue(
    assetEnvironment.createUrl({
      environmentId,
      input: { resource },
    }),
  );
  if (result._tag === "Failure") {
    return { _tag: "Failure" };
  }
  if (preparedConnection._tag === "None" || result._tag !== "Success") {
    return { _tag: "Loading" };
  }
  const url = resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl);
  return url === null
    ? { _tag: "Failure" }
    : {
        _tag: "Success",
        url,
        ...(result.value.sourcePath !== undefined ? { sourcePath: result.value.sourcePath } : {}),
      };
}

export function useAssetUrl(environmentId: EnvironmentId, resource: AssetResource): string | null {
  const result = useAssetUrlState(environmentId, resource);
  if (result._tag !== "Success") {
    return null;
  }
  return result.url;
}

/**
 * Resources the collection atom can key. Empty attachment ids fail
 * `AssetResource` decode, which throws `InvalidAssetCollectionKeyError`
 * during render.
 */
export function isQueryableAssetResource(resource: AssetResource): boolean {
  return resource._tag !== "attachment" || resource.attachmentId.trim().length > 0;
}

/**
 * Re-aligns query results (from the filtered, queryable subset) back onto the
 * original resource list. Unqueryable slots are `null`.
 */
export function alignQueryableAssetUrls<T>(
  resources: ReadonlyArray<AssetResource>,
  queryableResults: ReadonlyArray<T | null>,
): Array<T | null> {
  let index = 0;
  return resources.map((resource) => {
    if (!isQueryableAssetResource(resource)) return null;
    return queryableResults[index++] ?? null;
  });
}

export function useAssetUrls(
  environmentId: EnvironmentId,
  resources: ReadonlyArray<AssetResource>,
): ReadonlyArray<string | null> {
  const preparedConnection = usePreparedConnection(environmentId);
  const queryableResources = resources.filter(isQueryableAssetResource);
  const results = useAtomValue(
    assetEnvironment.createUrls({
      environmentId,
      resources: queryableResources,
    }),
  );
  return useMemo(() => {
    if (preparedConnection._tag === "None") {
      return resources.map(() => null);
    }
    const queryableUrls = results.map((result) =>
      AsyncResult.isSuccess(result)
        ? resolveAssetUrl(preparedConnection.value.httpBaseUrl, result.value.relativeUrl)
        : null,
    );
    return alignQueryableAssetUrls(resources, queryableUrls);
  }, [preparedConnection, resources, results]);
}
