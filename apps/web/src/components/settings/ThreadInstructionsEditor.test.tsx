import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { resolveSettingsScope } from "./settingsScope";

const state = vi.hoisted(() => ({
  environments: [] as ReturnType<typeof environment>[],
  failing: new Set<string>(),
  writable: true,
}));

function environment(id: string) {
  return {
    environmentId: EnvironmentId.make(id),
    label: id,
    connection: { phase: "connected" as const },
    serverConfig: { settings: { ...DEFAULT_SERVER_SETTINGS } },
  };
}

vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    scope: resolveSettingsScope({}, [], state.environments),
    environments: state.environments,
  }),
}));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: () => state.environments[0]!.serverConfig.settings,
  useScopedSettingsMixed: (keys: readonly (keyof typeof DEFAULT_SERVER_SETTINGS)[]) =>
    state.environments.some((entry) =>
      keys.some(
        (key) =>
          entry.serverConfig.settings[key] !== state.environments[0]!.serverConfig.settings[key],
      ),
    ),
  useScopedSettingsWriteAllowed: () => state.writable,
}));
vi.mock("~/state/server", () => ({ serverEnvironment: { updateSettings: "updateSettings" } }));
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand:
    () =>
    async ({
      environmentId,
      input,
    }: {
      environmentId: EnvironmentId;
      input: { patch: ServerSettingsPatch };
    }) => {
      if (state.failing.has(environmentId))
        return AsyncResult.failure(Cause.fail(new Error("Connection lost")));
      const target = state.environments.find((entry) => entry.environmentId === environmentId)!;
      target.serverConfig.settings = applyServerSettingsPatch(
        target.serverConfig.settings,
        input.patch,
      );
      return AsyncResult.success(undefined);
    },
}));
vi.mock("../ui/button", () => ({ Button: "button" }));
vi.mock("../ui/textarea", () => ({ Textarea: "textarea" }));

import { ThreadInstructionsEditor } from "./ThreadInstructionsEditor";

let renderer: ReactTestRenderer;
function mount() {
  act(() => {
    renderer = create(
      <ThreadInstructionsEditor
        setting="globalThreadInstructions"
        label="Global instructions"
        description="Guidance for every project."
        placeholder="Write guidance."
      />,
    );
  });
}
function edit(value: string) {
  act(() => renderer.root.findByType("textarea").props.onChange({ target: { value } }));
}
async function save() {
  await act(async () => {
    renderer.root.findByType("button").props.onClick();
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.environments = [environment("Laptop"), environment("Remote")];
  state.failing.clear();
  state.writable = true;
  mount();
});
afterEach(() => {
  act(() => renderer.unmount());
  vi.unstubAllGlobals();
});

describe("ThreadInstructionsEditor", () => {
  it("saves a draft across environments, restores it after reopening, and clears it", async () => {
    edit("Use plain English.");
    await save();
    act(() => renderer.unmount());
    mount();
    expect(renderer.root.findByType("textarea").props.value).toBe("Use plain English.");
    expect(
      state.environments.every(
        (entry) => entry.serverConfig.settings.globalThreadInstructions === "Use plain English.",
      ),
    ).toBe(true);
    edit("");
    await save();
    expect(
      state.environments.every(
        (entry) => entry.serverConfig.settings.globalThreadInstructions === "",
      ),
    ).toBe(true);
  });

  it("retains the draft after a partial save and retries the failed environment", async () => {
    state.failing.add("Remote");
    edit("Run relevant tests.");
    await save();
    expect(renderer.root.findByType("textarea").props.value).toBe("Run relevant tests.");
    expect(renderer.root.findByProps({ role: "status" }).children.join("")).toContain(
      "Remote: Connection lost",
    );
    expect(state.environments[1]!.serverConfig.settings.globalThreadInstructions).toBe("");
    state.failing.clear();
    await save();
    expect(state.environments[1]!.serverConfig.settings.globalThreadInstructions).toBe(
      "Run relevant tests.",
    );
    expect(renderer.root.findByProps({ role: "status" }).children).toEqual(["Saved"]);
  });
});
