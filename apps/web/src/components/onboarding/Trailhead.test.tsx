// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  importThreads: vi.fn(),
  createProject: vi.fn(),
  complete: vi.fn(),
  refresh: vi.fn(),
  toast: vi.fn(),
  agentSurvey: "ready" as "ready" | "needsSetup",
  candidates: [] as Array<Record<string, unknown>>,
  projects: [] as Array<{ id: string; environmentId: string; workspaceRoot: string }>,
}));
vi.mock("../../state/session", () => ({
  useEnvironmentScope: () => true,
  useEnvironmentsWithScope: (environments: Array<{ environmentId: string }>) =>
    new Set(environments.map((entry) => entry.environmentId)),
  readEnvironmentScope: () => true,
}));
vi.mock("../../state/agentSessions", () => ({ agentSessionImport: "import" }));
vi.mock("../../state/projects", () => ({ projectEnvironment: { create: "create" } }));
vi.mock("../../state/use-atom-command", () => ({
  useAtomCommand: (command: string) =>
    command === "import"
      ? mocks.importThreads
      : command === "create"
        ? mocks.createProject
        : mocks.refresh,
}));
vi.mock("../../onboarding/firstRun", () => ({ useCompleteOnboarding: () => mocks.complete }));
vi.mock("../../state/entities", () => ({
  useProjects: () => mocks.projects,
  readProjects: () => mocks.projects,
}));
vi.mock("../../state/environments", () => {
  const environment = {
    environmentId: "test-env",
    label: "Computer",
    connection: { phase: "connected" },
    entry: { enabled: true },
  };
  return {
    useEnvironments: () => ({ environments: [environment] }),
    usePrimaryEnvironment: () => environment,
  };
});
vi.mock("../../state/server", () => ({
  serverEnvironment: {
    providersValueAtom: () => [],
    configValueAtom: () => null,
    refreshProviders: "refresh",
  },
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: (value: unknown) => value }));
vi.mock("../../onboarding/useAgentSurveys", () => ({
  useAgentSurveys: (ids: readonly string[]) =>
    ids.map((environmentId) => ({ environmentId, providers: [], survey: mocks.agentSurvey })),
}));
vi.mock("../../onboarding/useProjectScans", () => ({
  useProjectScans: (ids: readonly string[]) =>
    ids.map((environmentId) => ({
      environmentId,
      isPending: false,
      error: null,
      refresh: mocks.refresh,
      data: { truncated: false, candidates: mocks.candidates },
    })),
}));
vi.mock("../../connection/onboarding", () => ({ connectPairing: vi.fn() }));
vi.mock("../../state/terminal", () => ({ terminalEnvironment: {} }));
vi.mock("../clerk/useT3ConnectAuthPrompt", () => ({ useT3ConnectAuthPrompt: vi.fn() }));
vi.mock("../../cloud/publicConfig", () => ({ hasCloudPublicConfig: () => false }));
vi.mock("../ThreadTerminalDrawer", () => ({ TerminalViewport: () => null }));
vi.mock("../settings/ChatGptWelcomeCoordinator", () => ({ ChatGptWelcomeCoordinator: () => null }));
vi.mock("../settings/CodexSetupSection", () => ({
  CodexSetupSection: () => null,
  AddManagedCodexAccountDialog: () => null,
}));
vi.mock("../cloud/CloudEnvironmentConnectList", () => ({
  CloudEnvironmentConnectRows: () => null,
}));
vi.mock("../ui/toast", () => ({
  toastManager: { add: mocks.toast, close: vi.fn(), update: vi.fn() },
}));

import { Trailhead } from "./Trailhead";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(Element.prototype, "getAnimations", {
    configurable: true,
    value: () => [],
  });
  mocks.agentSurvey = "ready";
  mocks.candidates = [
    {
      path: "/project",
      title: "project",
      projectId: "test-project",
      threadCount: 29,
      lastActiveAt: new Date().toISOString(),
      sources: ["codex"],
    },
  ];
  mocks.projects = [{ id: "test-project", environmentId: "test-env", workspaceRoot: "/project" }];
  mocks.complete.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
  mocks.importThreads.mockResolvedValue({
    _tag: "Success",
    value: { importedCount: 28, skippedCount: 1 },
  });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function button(label: string) {
  return [...document.querySelectorAll("button")].find(
    (element) => element.textContent?.trim() === label,
  );
}

async function click(label: string) {
  const target = button(label);
  expect(target, `button ${label}`).toBeDefined();
  await act(async () => target!.click());
}

function currentStep() {
  return document.querySelector("[data-trailhead-step]")?.getAttribute("data-trailhead-step");
}

it("walks past the ridge when agents are ready and lands on the imported project", async () => {
  const onDone = vi.fn();
  await act(async () => root.render(<Trailhead localAvailable onDone={onDone} />));
  await click("Agents are ready — pick projects");
  expect(currentStep()).toBe("saddle");
  await click("Import 1 project");
  expect(currentStep()).toBe("summit");
  expect(document.body.textContent).toContain(
    "Imported 28 threads. 1 thread could not be imported.",
  );
  await click("Start the first thread");
  expect(mocks.complete).toHaveBeenCalledOnce();
  expect(onDone).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("test-env"),
    projectId: ProjectId.make("test-project"),
  });
});

it("stops at the ridge when no agent is ready, then skips an empty saddle", async () => {
  mocks.agentSurvey = "needsSetup";
  mocks.candidates = [];
  const onDone = vi.fn();
  await act(async () => root.render(<Trailhead localAvailable onDone={onDone} />));
  await click("Continue");
  expect(currentStep()).toBe("ridge");
  await click("Continue");
  expect(currentStep()).toBe("summit");
  await click("Open T3 Pretty");
  expect(onDone).toHaveBeenCalledWith(undefined);
});

it("returns to a passed waypoint from the ridge line", async () => {
  await act(async () => root.render(<Trailhead localAvailable onDone={vi.fn()} />));
  await click("Agents are ready — pick projects");
  const back = document.querySelector<HTMLButtonElement>('button[aria-label="Back to Ridge"]');
  expect(back).not.toBeNull();
  await act(async () => back!.click());
  expect(currentStep()).toBe("ridge");
});

it("stays on the summit when saving completion fails and finishes on retry", async () => {
  mocks.complete.mockRejectedValueOnce(new Error("settings unavailable"));
  const onDone = vi.fn();
  await act(async () => root.render(<Trailhead localAvailable onDone={onDone} />));
  await click("Agents are ready — pick projects");
  await click("Skip import");
  await click("Open T3 Pretty");
  expect(onDone).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ type: "error", title: "Could not finish setup" }),
  );
  await click("Open T3 Pretty");
  expect(onDone).toHaveBeenCalledOnce();
  expect(mocks.importThreads).not.toHaveBeenCalled();
});

it("lets the summit retry when opening the app fails after saving", async () => {
  const onDone = vi.fn().mockRejectedValueOnce(new Error("navigation failed"));
  await act(async () => root.render(<Trailhead localAvailable onDone={onDone} />));
  await click("Agents are ready — pick projects");
  await click("Skip import");
  await click("Open T3 Pretty");
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({ type: "error", description: "T3 Pretty could not open. Try again." }),
  );
  await click("Open T3 Pretty");
  expect(onDone).toHaveBeenCalledTimes(2);
});
