import { useAtomValue } from "@effect/atom-react";
import {
  type AssetUrlState,
  assetUrlStateFromResult,
  EMPTY_ASSET_URL_ATOM,
  resolveAssetUrl,
} from "@t3tools/client-runtime/state/assets";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type { AssetResource, EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useCallback, useMemo } from "react";

import { assetEnvironment, localMediaEnvironment } from "~/state/assets";
import { useFilesystemReadAccess } from "~/state/filesystem";
import { usePreparedConnection } from "~/state/session";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";

export { resolveAssetUrl, type AssetUrlState } from "@t3tools/client-runtime/state/assets";

/**
 * Returns whether the resource can be submitted to `createUrl`. False for
 * empty-id attachments, which crash before hitting the RPC due to the
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

export function useAssetUrlState(
  environmentId: EnvironmentId | null,
  resource: AssetResource | null,
): AssetUrlState {
  const fileAccess = useFilesystemReadAccess(environmentId);
  const canReadResource =
    fileAccess.canReadFiles ||
    (resource?._tag !== "workspace-file" &&
      resource?._tag !== "media-file" &&
      resource?._tag !== "draft-workspace-file");
  const preparedConnection = usePreparedConnection(environmentId);
  const localMedia = useAtomValue(localMediaEnvironment);
  const result = useAtomValue(
    !canReadResource || environmentId === null || resource === null
      ? EMPTY_ASSET_URL_ATOM
      : assetEnvironment.createUrl({ environmentId, input: { resource } }),
  );
  if (!canReadResource) return { _tag: fileAccess.isPending ? "Loading" : "Failure" };
  return assetUrlStateFromResult(
    result,
    preparedConnection._tag === "Some" ? preparedConnection.value.httpBaseUrl : null,
    localMedia?.httpBaseUrl,
  );
}

export function useAssetUrlRefresh(
  environmentId: EnvironmentId | null,
  resource: AssetResource | null,
): () => Promise<string | null> {
  const connection = usePreparedConnection(environmentId);
  const httpBaseUrl = connection._tag === "Some" ? connection.value.httpBaseUrl : null;
  const localMedia = useAtomValue(localMediaEnvironment);
  const allowedHttpBaseUrl = localMedia?.httpBaseUrl;
  const refresh = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  return useCallback(async () => {
    if (environmentId === null || resource === null || httpBaseUrl === null) return null;
    const result = await refresh({ environmentId, input: { resource } });
    if (result._tag === "Failure") throw squashAtomCommandFailure(result);
    return resolveAssetUrl(httpBaseUrl, result.value.relativeUrl, allowedHttpBaseUrl);
  }, [environmentId, resource, refresh, httpBaseUrl, allowedHttpBaseUrl]);
}

export function useAssetUrls(
  environmentId: EnvironmentId,
  resources: ReadonlyArray<AssetResource>,
): ReadonlyArray<string | null> {
  const preparedConnection = usePreparedConnection(environmentId);
  const localMedia = useAtomValue(localMediaEnvironment);
  const allowedHttpBaseUrl = localMedia?.httpBaseUrl;
  const { canReadFiles } = useFilesystemReadAccess(environmentId);
  const allowedResources = useMemo(
    () =>
      canReadFiles
        ? resources
        : resources.filter(
            (resource) =>
              resource._tag !== "workspace-file" &&
              resource._tag !== "media-file" &&
              resource._tag !== "draft-workspace-file",
          ),
    [canReadFiles, resources],
  );
  const results = useAtomValue(
    assetEnvironment.createUrls({
      environmentId,
      resources: allowedResources,
    }),
  );
  return useMemo(() => {
    if (preparedConnection._tag === "None") return resources.map(() => null);
    let resultIndex = 0;
    return resources.map((resource) => {
      if (
        !canReadFiles &&
        (resource._tag === "workspace-file" ||
          resource._tag === "media-file" ||
          resource._tag === "draft-workspace-file")
      )
        return null;
      const result = results[resultIndex++];
      return result && AsyncResult.isSuccess(result)
        ? resolveAssetUrl(
            preparedConnection.value.httpBaseUrl,
            result.value.relativeUrl,
            allowedHttpBaseUrl,
          )
        : null;
    });
  }, [allowedHttpBaseUrl, canReadFiles, preparedConnection, resources, results]);
}
