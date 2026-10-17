// @effect-diagnostics nodeBuiltinImport:off -- Verifies desktop startup through a real local control socket, without Electron or a backend process.
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { resolveDesktopAppControlAddress } from "@t3tools/shared/desktopAppControl";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { assert, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Ref from "effect/Ref";
import { vi } from "vite-plus/test";

import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopSnapShot from "../snapShot/DesktopSnapShot.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import { bootstrap } from "./DesktopApp.ts";
import * as DesktopAppActivation from "./DesktopAppActivation.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopLegacyLocalStorage from "./DesktopLegacyLocalStorage.ts";
import * as DesktopState from "./DesktopState.ts";

vi.mock("../ipc/DesktopIpcHandlers.ts", () => ({
  installDesktopIpcHandlers: () => Effect.void,
}));

it.effect("accepts desktop app commands when the local environment is disabled", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const platform = yield* HostProcess.Platform;
      const userId = yield* HostProcess.UserId;
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "t3-remote-desktop-" });
      const target = resolveDesktopAppControlAddress({
        stateDir: NodePath.join(root, "userdata"),
        platform,
        tempDir: NodeOS.tmpdir(),
        userId,
        joinPath: NodePath.join,
      });
      const activation = DesktopAppActivation.DesktopAppActivation.of({
        start: Effect.acquireRelease(
          Effect.promise(() =>
            DesktopAppActivation.startDesktopAppControlServer({
              ...target,
              userId,
              handle: async (request) => ({
                version: 1,
                requestId: request.requestId,
                ok: true,
                projectId: ProjectId.make("remote-project"),
                threadId: ThreadId.make("remote-thread"),
              }),
              cancel: () => undefined,
              onReclaimError: () => undefined,
            }),
          ),
          (server) => Effect.promise(() => server.close()),
        ).pipe(Effect.asVoid),
        setRendererReady: () => Effect.void,
        complete: () => Effect.void,
      });
      const quitting = yield* Ref.make(false);
      const backendReady = yield* Ref.make(false);
      // The remote-only branch must not acquire any backend services. Other
      // startup boundaries are inert; the app-control transport remains real.
      const context = Context.make(DesktopState.DesktopState, { quitting, backendReady }).pipe(
        Context.add(DesktopEnvironment.DesktopEnvironment, {
          isDevelopment: false,
          clientDistPath: "/bundled/client",
        } as DesktopEnvironment.DesktopEnvironment["Service"]),
        Context.add(DesktopAppSettings.DesktopAppSettings, {
          get: Effect.succeed({
            ...DesktopAppSettings.DEFAULT_DESKTOP_SETTINGS,
            localEnvironmentEnabled: false,
          }),
        } as DesktopAppSettings.DesktopAppSettings["Service"]),
        Context.add(DesktopWindow.DesktopWindow, {
          createMain: Effect.die("unexpected main window creation"),
          ensureMain: Effect.die("unexpected main window creation"),
          revealOrCreateMain: Effect.die("unexpected main window creation"),
          activate: Effect.void,
          createMainIfBackendReady: Effect.void,
          showConnectingSplash: Effect.void,
          handleBackendReady: () => Effect.void,
          handleBackendNotReady: Effect.void,
          flushMainWindowBounds: Effect.void,
          prepareCaptureReveal: Effect.void,
          dispatchMenuAction: () => Effect.void,
          dispatchSnapShotEvent: () => Effect.void,
          zoomMain: () => Effect.void,
          setDockAttention: () => Effect.void,
          setWindowButtonVisibility: () => Effect.void,
          runMainContentsCommand: () => Effect.void,
          syncAppearance: Effect.void,
        }),
        Context.add(DesktopSnapShot.DesktopSnapShot, {
          initialize: Effect.void,
        } as DesktopSnapShot.DesktopSnapShot["Service"]),
        Context.add(DesktopAppActivation.DesktopAppActivation, activation),
        Context.add(ElectronProtocol.ElectronProtocol, {
          registerDesktopProtocol: () => Effect.void,
        }),
        Context.add(DesktopLegacyLocalStorage.DesktopLegacyLocalStorage, {
          load: () => Effect.void,
          take: Effect.succeedNone,
          complete: Effect.void,
        }),
        Context.add(DesktopAppIdentity.DesktopAppIdentity, {
          resolveUserDataPath: Effect.succeed(root),
          commitHash: Effect.succeedNone,
          configure: Effect.void,
        }),
      );
      yield* bootstrap.pipe(
        Effect.provide(context as Context.Context<Effect.Services<typeof bootstrap>>),
      );

      const response = yield* Effect.promise(
        () =>
          new Promise<string>((resolve, reject) => {
            const socket = NodeNet.createConnection(target.address);
            socket.setEncoding("utf8");
            let buffer = "";
            socket.once("error", reject);
            socket.once("connect", () =>
              socket.write(
                `${JSON.stringify({
                  version: 1,
                  requestId: "remote-only-launch",
                  type: "open-workspace",
                  workspaceRoot: root,
                  platform,
                })}\n`,
              ),
            );
            socket.on("data", (chunk) => {
              buffer += chunk;
              if (!buffer.includes("\n")) return;
              socket.destroy();
              resolve(buffer);
            });
          }),
      );
      assert.deepEqual(JSON.parse(response), {
        version: 1,
        requestId: "remote-only-launch",
        ok: true,
        projectId: "remote-project",
        threadId: "remote-thread",
      });
    }),
  ).pipe(Effect.provide(NodeFileSystem.layer)),
);
