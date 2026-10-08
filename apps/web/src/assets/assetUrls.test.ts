import {
  AuthFilesystemReadScope,
  EnvironmentAuthorizationError,
  EnvironmentId,
  ThreadId,
  type AuthSessionState,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  session: null as Pick<AuthSessionState, "authenticated" | "scopes"> | null,
  phase: "connected" as "connected" | "offline",
  assetAtom: {},
  mint: vi.fn(),
  assetQuery: vi.fn(),
}));

vi.mock("react", () => ({ useCallback: <A>(callback: A) => callback }));
vi.mock("@effect/atom-react", () => ({
  useAtomValue: (atom: unknown) =>
    atom === state.assetAtom
      ? AsyncResult.success({ relativeUrl: "/api/assets/image.png", expiresAt: 1 })
      : AsyncResult.initial(false),
}));
vi.mock("~/state/session", () => ({
  usePreparedConnection: () => ({ _tag: "Some", value: { httpBaseUrl: "https://host.test" } }),
}));
vi.mock("~/state/filesystem", async () => {
  const { resolveFilesystemReadAccess } = await import("@t3tools/client-runtime/state/filesystem");
  return {
    useFilesystemReadAccess: () =>
      resolveFilesystemReadAccess({
        isCatalogReady: true,
        connection: { phase: state.phase, error: null },
        session: state.session,
        sessionError: null,
      }),
  };
});
vi.mock("~/state/assets", () => ({
  assetEnvironment: { createUrl: state.assetQuery },
}));
vi.mock("~/state/use-atom-query-runner", () => ({ useAtomQueryRunner: () => state.mint }));

import {
  alignQueryableAssetUrls,
  isQueryableAssetResource,
  resolveAssetUrl,
  useAssetUrlRefresh,
  useAssetUrlState,
} from "./assetUrls";

const environmentId = EnvironmentId.make("asset-environment");
const threadId = ThreadId.make("asset-thread");
const resource = { _tag: "media-file", threadId, path: "/repo/image.png" } as const;

beforeEach(() => {
  state.session = null;
  state.phase = "connected";
  state.assetQuery.mockReset().mockReturnValue(state.assetAtom);
  state.mint
    .mockReset()
    .mockResolvedValue(AsyncResult.success({ relativeUrl: "/api/assets/image.png", expiresAt: 1 }));
});

it.each(["workspace-file", "media-file"] as const)(
  "keeps %s loading until its file grant resolves",
  (_tag) => {
    expect(useAssetUrlState(environmentId, { ...resource, _tag })).toEqual({ _tag: "Loading" });
    expect(state.assetQuery).not.toHaveBeenCalled();

    state.session = { authenticated: true, scopes: [AuthFilesystemReadScope] };
    expect(useAssetUrlState(environmentId, { ...resource, _tag })).toEqual({
      _tag: "Success",
      expiresAt: 1,
      url: "https://host.test/api/assets/image.png",
    });
  },
);

it("hides host assets with a denied grant while preserving attachments", () => {
  state.session = { authenticated: true, scopes: [] };
  expect(useAssetUrlState(environmentId, resource)).toEqual({ _tag: "Failure" });
  expect(state.assetQuery).not.toHaveBeenCalled();
  expect(useAssetUrlState(environmentId, { _tag: "attachment", attachmentId: "upload" })).toEqual({
    _tag: "Success",
    expiresAt: 1,
    url: "https://host.test/api/assets/image.png",
  });
});

it("stops waiting for an unresolved grant when the connection is offline", () => {
  state.phase = "offline";
  expect(useAssetUrlState(environmentId, resource)).toEqual({ _tag: "Failure" });
  expect(state.assetQuery).not.toHaveBeenCalled();
});

it("lets the server authorize an explicit refresh before the client grant loads", async () => {
  await expect(useAssetUrlRefresh(environmentId, resource)()).resolves.toBe(
    "https://host.test/api/assets/image.png",
  );
  expect(state.mint).toHaveBeenCalledWith({ environmentId, input: { resource } });

  const denied = new EnvironmentAuthorizationError({
    message: "This connection cannot read host files.",
    requiredScope: AuthFilesystemReadScope,
  });
  state.mint.mockResolvedValue(AsyncResult.failure(Cause.fail(denied)));
  await expect(useAssetUrlRefresh(environmentId, resource)()).rejects.toBe(denied);
});

describe("resolveAssetUrl", () => {
  it("resolves an environment-relative asset URL", () => {
    expect(
      resolveAssetUrl("https://environment.example/base/", "/api/assets/signed-token/favicon.png"),
    ).toBe("https://environment.example/api/assets/signed-token/favicon.png");
  });

  it("rejects an invalid environment base URL", () => {
    expect(resolveAssetUrl("not a URL", "/api/assets/signed-token/favicon.png")).toBeNull();
  });

  it("rejects asset URLs that escape the environment origin", () => {
    expect(
      resolveAssetUrl("https://environment.example/base/", "//attacker.example/image.png"),
    ).toBeNull();
    expect(
      resolveAssetUrl("https://environment.example/base/", "https://attacker.example/image.png"),
    ).toBeNull();
  });

  it("keeps a local-server asset URL when that server is allowed to serve the file", () => {
    const localUrl = "https://local.test/api/assets/local/media";
    expect(resolveAssetUrl("https://remote.test/", localUrl, "https://local.test")).toBe(localUrl);
    expect(resolveAssetUrl("https://remote.test/", localUrl)).toBeNull();
    expect(
      resolveAssetUrl(
        "https://remote.test/",
        "https://attacker.example/api/assets/x",
        "https://local.test",
      ),
    ).toBeNull();
  });
});

describe("queryable asset resources", () => {
  it("rejects empty attachment ids", () => {
    expect(isQueryableAssetResource({ _tag: "attachment", attachmentId: "" })).toBe(false);
    expect(isQueryableAssetResource({ _tag: "attachment", attachmentId: "   " })).toBe(false);
    expect(isQueryableAssetResource({ _tag: "attachment", attachmentId: "att-1" })).toBe(true);
  });

  it("aligns queryable results onto the original resource list", () => {
    const resources = [
      { _tag: "attachment" as const, attachmentId: "" },
      { _tag: "attachment" as const, attachmentId: "att-1" },
      { _tag: "attachment" as const, attachmentId: "att-2" },
    ];
    expect(alignQueryableAssetUrls(resources, ["url-1", "url-2"])).toEqual([
      null,
      "url-1",
      "url-2",
    ]);
  });
});
