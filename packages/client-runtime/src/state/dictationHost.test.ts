import { EnvironmentId, type ServerConfig } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Option from "effect/Option";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";

import { RelayConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import type { EnvironmentPresentation } from "../connection/presentation.ts";
import { createDictationHostAtoms } from "./dictation.ts";

function host(id: string, available = true, connected = true) {
  const environmentId = EnvironmentId.make(id);
  const target = new RelayConnectionTarget({ environmentId, label: id });
  const prepared: PreparedConnection = {
    environmentId,
    label: id,
    target,
    httpBaseUrl: `https://${id}.example.test`,
    socketUrl: `wss://${id}.example.test/ws`,
    httpAuthorization: { _tag: "Bearer", token: `${id}-session` },
  };
  const presentation: EnvironmentPresentation = {
    entry: { target, profile: Option.none() },
    connection: { phase: connected ? "connected" : "offline", error: null, traceId: null },
    serverConfig: {
      environment: { capabilities: available ? { voiceDictation: true } : {} },
    } as ServerConfig,
  };
  return { environmentId, prepared, presentation };
}

function harness(hosts: ReturnType<typeof host>[]) {
  const presentationsAtom = Atom.make<ReadonlyMap<EnvironmentId, EnvironmentPresentation>>(
    new Map(hosts.map((entry) => [entry.environmentId, entry.presentation])),
  );
  const preparedConnectionValueAtom = Atom.family((id: EnvironmentId) =>
    Atom.make(Option.fromNullishOr(hosts.find((entry) => entry.environmentId === id)?.prepared)),
  );
  const hostAtom = createDictationHostAtoms({ presentationsAtom, preparedConnectionValueAtom });
  return {
    registry: AtomRegistry.make(),
    hostAtom,
    presentationsAtom,
    preparedConnectionValueAtom,
  };
}

describe("shared dictation hosts", () => {
  it("uses one Groq host for drafts running on other Surge Connect machines", () => {
    const a = host("thread-a", false);
    const b = host("thread-b", false);
    const groq = host("groq-host");
    const h = harness([a, b, groq]);
    expect(h.registry.get(h.hostAtom(a.environmentId))).toBe(groq.prepared);
    expect(h.registry.get(h.hostAtom(b.environmentId))).toBe(groq.prepared);
    expect(h.registry.get(h.hostAtom(null))).toBe(groq.prepared);
    h.registry.dispose();
  });

  it("prefers the current draft's capable host, skipping offline or unconfigured hosts", () => {
    const offline = host("offline", true, false);
    const unavailable = host("old-server", false);
    const fallback = host("fallback");
    const current = host("current");
    const h = harness([offline, unavailable, fallback, current]);
    expect(h.registry.get(h.hostAtom(current.environmentId))).toBe(current.prepared);
    expect(h.registry.get(h.hostAtom(offline.environmentId))).toBe(fallback.prepared);
    h.registry.dispose();
  });

  it("reacts to credential changes, disconnects, and removal without keeping a stale host", () => {
    const first = host("first");
    const fallback = host("fallback");
    const h = harness([first, fallback]);
    const selected = h.hostAtom(first.environmentId);
    const release = h.registry.mount(selected);
    expect(h.registry.get(selected)).toBe(first.prepared);
    const refreshed = { ...first.prepared, httpBaseUrl: "https://renewed.example.test" };
    h.registry.set(h.preparedConnectionValueAtom(first.environmentId), Option.some(refreshed));
    expect(h.registry.get(selected)).toBe(refreshed);
    h.registry.set(h.preparedConnectionValueAtom(first.environmentId), Option.none());
    expect(h.registry.get(selected)).toBe(fallback.prepared);
    h.registry.set(h.presentationsAtom, new Map());
    expect(h.registry.get(selected)).toBeNull();
    release();
    h.registry.dispose();
  });
});
