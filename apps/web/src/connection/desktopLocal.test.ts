import {
  BearerConnectionTarget,
  PrimaryConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { EnvironmentId, PRIMARY_LOCAL_ENVIRONMENT_ID } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  createDesktopSecondaryBootstrapsReader,
  desktopLocalBackendId,
  desktopLocalConnectionId,
  isDesktopLocalConnectionTarget,
} from "./desktopLocal";

describe("desktop local connection identity", () => {
  it("preserves the desktop backend instance id", () => {
    const target = new BearerConnectionTarget({
      connectionId: desktopLocalConnectionId("wsl:Ubuntu"),
      environmentId: EnvironmentId.make("environment-wsl"),
      label: "WSL (Ubuntu)",
    });

    expect(isDesktopLocalConnectionTarget(target)).toBe(true);
    expect(desktopLocalBackendId(target)).toBe("wsl:Ubuntu");
  });

  it("does not classify the primary environment as desktop-local", () => {
    const target = new PrimaryConnectionTarget({
      environmentId: EnvironmentId.make("environment-primary"),
      httpBaseUrl: "http://127.0.0.1:3773",
      label: "This device",
      wsBaseUrl: "ws://127.0.0.1:3773",
    });

    expect(isDesktopLocalConnectionTarget(target)).toBe(false);
    expect(desktopLocalBackendId(target)).toBeNull();
  });
});

describe("desktop local topology reads", () => {
  it("distinguishes a successful empty topology from a read failure", async () => {
    let readBootstraps = () => [];
    const reader = createDesktopSecondaryBootstrapsReader(() => ({
      getLocalEnvironmentBootstraps: () => readBootstraps(),
    }));

    await expect(reader.readResult()).resolves.toEqual({ _tag: "Success", bootstraps: [] });

    const cause = new Error("IPC unavailable");
    readBootstraps = () => {
      throw cause;
    };
    await expect(reader.readResult()).resolves.toEqual({ _tag: "Failure", cause });
  });

  it("filters the primary bootstrap from successful topology reads", async () => {
    const secondary = {
      id: "wsl:Ubuntu",
      label: "WSL: Ubuntu",
      httpBaseUrl: "http://127.0.0.1:4000",
      wsBaseUrl: "ws://127.0.0.1:4000",
    };

    const reader = createDesktopSecondaryBootstrapsReader(() => ({
      getLocalEnvironmentBootstraps: () => [
        {
          ...secondary,
          id: PRIMARY_LOCAL_ENVIRONMENT_ID,
          label: "Windows",
        },
        secondary,
      ],
    }));

    await expect(reader.readResult()).resolves.toEqual({
      _tag: "Success",
      bootstraps: [secondary],
    });
  });

  it("retains the last successful snapshot only until another read succeeds", async () => {
    const secondary = {
      id: "wsl:Ubuntu",
      label: "WSL: Ubuntu",
      httpBaseUrl: "http://127.0.0.1:4000",
      wsBaseUrl: "ws://127.0.0.1:4000",
    };
    let readBootstraps = () => [secondary];
    const reader = createDesktopSecondaryBootstrapsReader(() => ({
      getLocalEnvironmentBootstraps: () => readBootstraps(),
    }));

    await reader.readResult();
    const connectedSnapshot = reader.readSnapshot();
    expect(connectedSnapshot).toEqual([secondary]);

    readBootstraps = () => {
      throw new Error("IPC unavailable");
    };
    await reader.readResult();
    expect(reader.readSnapshot()).toBe(connectedSnapshot);

    readBootstraps = () => [];
    await reader.readResult();
    const removedSnapshot = reader.readSnapshot();
    expect(removedSnapshot).toEqual([]);

    readBootstraps = () => {
      throw new Error("IPC unavailable again");
    };
    await reader.readResult();
    expect(reader.readSnapshot()).toBe(removedSnapshot);
  });

  it("shares an async bridge read and publishes its result immediately", async () => {
    const secondary = {
      id: "wsl:Ubuntu",
      label: "WSL: Ubuntu",
      httpBaseUrl: "http://127.0.0.1:4000",
      wsBaseUrl: "ws://127.0.0.1:4000",
    };
    let resolveRead!: (bootstraps: ReadonlyArray<typeof secondary>) => void;
    const read = vi.fn(
      () =>
        new Promise<ReadonlyArray<typeof secondary>>((resolve) => {
          resolveRead = resolve;
        }),
    );
    const reader = createDesktopSecondaryBootstrapsReader(() => ({
      getLocalEnvironmentBootstraps: read,
    }));
    const listener = vi.fn();
    reader.subscribe(listener);

    const first = reader.readResult();
    const second = reader.readResult();
    expect(second).toBe(first);
    expect(read).toHaveBeenCalledTimes(1);
    expect(reader.readSnapshot()).toEqual([]);

    resolveRead([secondary]);
    await expect(first).resolves.toEqual({ _tag: "Success", bootstraps: [secondary] });
    expect(reader.readSnapshot()).toEqual([secondary]);
    expect(listener).toHaveBeenCalledWith([secondary]);
  });

  it("does not expose an older bridge result after a replacement read wins", async () => {
    const older = {
      id: "wsl:Old",
      label: "Old WSL",
      httpBaseUrl: "http://127.0.0.1:4000",
      wsBaseUrl: "ws://127.0.0.1:4000",
    };
    const newer = {
      id: "wsl:New",
      label: "New WSL",
      httpBaseUrl: "http://127.0.0.1:5000",
      wsBaseUrl: "ws://127.0.0.1:5000",
    };
    let resolveOlder!: (value: ReadonlyArray<typeof older>) => void;
    let resolveNewer!: (value: ReadonlyArray<typeof newer>) => void;
    const olderRead = () =>
      new Promise<ReadonlyArray<typeof older>>((resolve) => {
        resolveOlder = resolve;
      });
    const newerRead = () =>
      new Promise<ReadonlyArray<typeof newer>>((resolve) => {
        resolveNewer = resolve;
      });
    let read = olderRead;
    const reader = createDesktopSecondaryBootstrapsReader(() => ({
      getLocalEnvironmentBootstraps: read,
    }));
    const listener = vi.fn();
    reader.subscribe(listener);

    const olderResult = reader.readResult();
    read = newerRead;
    const newerResult = reader.readResult();
    resolveNewer([newer]);
    await expect(newerResult).resolves.toEqual({ _tag: "Success", bootstraps: [newer] });
    resolveOlder([older]);
    await expect(olderResult).resolves.toEqual({ _tag: "Success", bootstraps: [newer] });
    expect(reader.readSnapshot()).toEqual([newer]);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("invalidates an older bridge result when its synchronous replacement fails", async () => {
    const older = {
      id: "wsl:Old",
      label: "Old WSL",
      httpBaseUrl: "http://127.0.0.1:4000",
      wsBaseUrl: "ws://127.0.0.1:4000",
    };
    let resolveOlder!: (value: ReadonlyArray<typeof older>) => void;
    const olderRead = () =>
      new Promise<ReadonlyArray<typeof older>>((resolve) => {
        resolveOlder = resolve;
      });
    const cause = new Error("replacement IPC unavailable");
    let read: () => ReadonlyArray<typeof older> | Promise<ReadonlyArray<typeof older>> = olderRead;
    const reader = createDesktopSecondaryBootstrapsReader(() => ({
      getLocalEnvironmentBootstraps: read,
    }));
    const listener = vi.fn();
    reader.subscribe(listener);

    const olderResult = reader.readResult();
    read = () => {
      throw cause;
    };
    await expect(reader.readResult()).resolves.toEqual({ _tag: "Failure", cause });

    resolveOlder([older]);
    await expect(olderResult).resolves.toEqual({ _tag: "Success", bootstraps: [] });
    expect(reader.readSnapshot()).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("times out a shared read and permits the next read to retry", async () => {
    vi.useFakeTimers();
    const read = vi.fn(
      () =>
        new Promise<ReadonlyArray<never>>(() => {
          // Deliberately unresolved IPC response.
        }),
    );
    const reader = createDesktopSecondaryBootstrapsReader(
      () => ({ getLocalEnvironmentBootstraps: read }),
      { readTimeoutMs: 50 },
    );

    const first = reader.readResult();
    expect(reader.readResult()).toBe(first);
    expect(read).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(50);
    await expect(first).resolves.toMatchObject({
      _tag: "Failure",
      cause: new Error("Desktop topology read timed out after 50ms."),
    });
    void reader.readResult();
    expect(read).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not let a timed-out read overwrite a successful retry", async () => {
    vi.useFakeTimers();
    const older = {
      id: "wsl:Old",
      label: "Old WSL",
      httpBaseUrl: "http://127.0.0.1:4000",
      wsBaseUrl: "ws://127.0.0.1:4000",
    };
    const newer = { ...older, id: "wsl:New", label: "New WSL" };
    let resolveOlder!: (value: ReadonlyArray<typeof older>) => void;
    let resolveNewer!: (value: ReadonlyArray<typeof newer>) => void;
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<ReadonlyArray<typeof older>>((resolve) => {
            resolveOlder = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<ReadonlyArray<typeof newer>>((resolve) => {
            resolveNewer = resolve;
          }),
      );
    const reader = createDesktopSecondaryBootstrapsReader(
      () => ({ getLocalEnvironmentBootstraps: read }),
      { readTimeoutMs: 50 },
    );
    const listener = vi.fn();
    reader.subscribe(listener);

    const olderResult = reader.readResult();
    await vi.advanceTimersByTimeAsync(50);
    await olderResult;
    const newerResult = reader.readResult();
    resolveNewer([newer]);
    await expect(newerResult).resolves.toEqual({ _tag: "Success", bootstraps: [newer] });

    resolveOlder([older]);
    await Promise.resolve();
    expect(reader.readSnapshot()).toEqual([newer]);
    expect(listener).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("keeps a replacement bridge current when the older bridge times out", async () => {
    vi.useFakeTimers();
    const secondary = {
      id: "wsl:New",
      label: "New WSL",
      httpBaseUrl: "http://127.0.0.1:5000",
      wsBaseUrl: "ws://127.0.0.1:5000",
    };
    let resolveReplacement!: (value: ReadonlyArray<typeof secondary>) => void;
    const olderRead = () =>
      new Promise<ReadonlyArray<typeof secondary>>(() => {
        // Deliberately unresolved IPC response.
      });
    const replacementRead = () =>
      new Promise<ReadonlyArray<typeof secondary>>((resolve) => {
        resolveReplacement = resolve;
      });
    let read = olderRead;
    const reader = createDesktopSecondaryBootstrapsReader(
      () => ({ getLocalEnvironmentBootstraps: read }),
      { readTimeoutMs: 50 },
    );

    void reader.readResult();
    await vi.advanceTimersByTimeAsync(25);
    read = replacementRead;
    const replacement = reader.readResult();
    await vi.advanceTimersByTimeAsync(25);
    resolveReplacement([secondary]);
    await expect(replacement).resolves.toEqual({ _tag: "Success", bootstraps: [secondary] });
    expect(reader.readSnapshot()).toEqual([secondary]);
    vi.useRealTimers();
  });
});
