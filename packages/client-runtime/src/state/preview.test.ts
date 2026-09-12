import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Layer from "effect/Layer";
import { Atom } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createPreviewEnvironmentAtoms,
  previewAutomationHostFocusConcurrencyKey,
  PREVIEW_STATE_IDLE_TTL_MS,
} from "./preview.ts";

describe("preview environment atoms", () => {
  it("releases idle preview snapshots and event streams before the generic TTL", () => {
    const runtime = Atom.runtime(Layer.empty) as unknown as Atom.AtomRuntime<
      EnvironmentRegistry,
      never
    >;
    const atoms = createPreviewEnvironmentAtoms(runtime);
    const target = {
      environmentId: EnvironmentId.make("environment-1"),
      input: { threadId: ThreadId.make("thread-1") },
    };

    expect(atoms.list(target).idleTTL).toBe(PREVIEW_STATE_IDLE_TTL_MS);
    expect(atoms.events(target).idleTTL).toBe(PREVIEW_STATE_IDLE_TTL_MS);
  });
});

describe("preview state commands", () => {
  it("keeps focus updates from replacement host connections independent", () => {
    const first = previewAutomationHostFocusConcurrencyKey({
      environmentId: "environment-1",
      input: { clientId: "client-1", connectionId: "connection-1" },
    });
    const replacement = previewAutomationHostFocusConcurrencyKey({
      environmentId: "environment-1",
      input: { clientId: "client-1", connectionId: "connection-2" },
    });

    expect(first).not.toBe(replacement);
  });
});
