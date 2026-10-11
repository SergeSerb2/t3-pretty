// @vitest-environment jsdom

import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadShellFixture } from "./test-fixtures";
import { threadRouteIsHydrating } from "./features/threads/thread-route-hydration";
import { projectThreadContentPresentation } from "./features/threads/threadContentPresentation";
import { buildThreadListV2Items } from "./features/threads/threadListV2";

const REMOTE_ENVIRONMENT_ID = EnvironmentId.make("7d1bf2b2");
const THREAD_ID = ThreadId.make("remote-thread-1");

function RemoteThreadShell(props: { readonly hasDetail: boolean; readonly message: string }) {
  const threads = [
    makeThreadShellFixture({
      environmentId: REMOTE_ENVIRONMENT_ID,
      id: THREAD_ID,
      title: "Serge remote launch",
    }),
  ];
  const items = buildThreadListV2Items({
    threads,
    environmentId: REMOTE_ENVIRONMENT_ID,
    searchQuery: "",
    now: "2026-10-11T22:21:00.000Z",
  }).items;
  const stillHydrating = threadRouteIsHydrating({
    isLoadingConnections: false,
    connectionState: "reconnecting",
    shellStatus: "synchronizing",
    shellHasError: false,
    hasShellSnapshot: true,
    detailStatus: props.hasDetail ? "cached" : "empty",
    detailHasError: false,
    hasDetail: props.hasDetail,
  });
  const presentation = projectThreadContentPresentation({
    hasDetail: props.hasDetail,
    detailError: null,
    detailDeleted: false,
    connectionState: "reconnecting",
  });
  return createElement(
    "div",
    null,
    items.map((item) => createElement("div", { key: item.thread.id }, item.thread.title)),
    stillHydrating
      ? createElement("div", null, "Opening thread…")
      : presentation.kind === "ready"
        ? createElement("div", null, props.message)
        : createElement("div", null, "blank"),
  );
}

describe("mobile remote thread shell smoke", () => {
  it("lists a remote thread and paints cached messages while subscribe is interrupted", () => {
    const markup = renderToStaticMarkup(
      createElement(RemoteThreadShell, {
        hasDetail: true,
        message: "Launch this remote thread",
      }),
    );
    expect(markup).toContain("Serge remote launch");
    expect(markup).toContain("Launch this remote thread");
    expect(markup).not.toContain("Opening thread…");
  });
});
