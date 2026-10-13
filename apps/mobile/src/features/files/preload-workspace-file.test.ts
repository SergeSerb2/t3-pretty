import { beforeEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  readFile: vi.fn(() => ({ kind: "read-file" })),
  highlight: vi.fn(() => ({ kind: "highlight" })),
}));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({ executeAtomQuery: mocks.query }));
vi.mock("../../state/atom-registry", () => ({ appAtomRegistry: {} }));
vi.mock("../../state/session", () => ({ readEnvironmentScope: () => true }));
vi.mock("../../state/projects", () => ({ projectEnvironment: { readFile: mocks.readFile } }));
vi.mock("./sourceHighlightingState", () => ({ sourceHighlightAtom: mocks.highlight }));

let document: typeof import("./source-file-document");
let preload: typeof import("./preload-workspace-file");
beforeEach(async () => {
  vi.resetModules();
  mocks.query.mockReset();
  mocks.readFile.mockClear();
  mocks.highlight.mockClear();
  document = await import("./source-file-document");
  preload = await import("./preload-workspace-file");
});

async function preview(contents: string) {
  const read = Promise.withResolvers<{ _tag: "Success"; value: { contents: string } }>();
  mocks.query.mockReturnValueOnce(read.promise).mockResolvedValue({ _tag: "Success", value: [] });
  preload.preloadWorkspaceFileContents({
    environmentId: EnvironmentId.make("environment-preload"),
    cwd: "/workspace",
    relativePath: "large.ts",
    theme: "light",
  });
  // The preload continuation subscribed first, so this result is its milestone.
  read.resolve({ _tag: "Success", value: { contents } });
  await read.promise;
}

it("does not build thousands of native source rows for an oversized speculative file", async () => {
  const prepare = vi.spyOn(document, "prepareSourceFileDocument");
  await preview("const value = 1;\n".repeat(40_000));
  expect(prepare.mock.calls.length).toBe(0);
  expect(mocks.query).toHaveBeenCalledTimes(1);
  expect(mocks.highlight).not.toHaveBeenCalled();
});

it("does not precompute an extreme row count even when its source text is small", async () => {
  const prepare = vi.spyOn(document, "prepareSourceFileDocument");
  await preview("x\n".repeat(20_000));
  expect(prepare.mock.calls.length).toBe(0);
  expect(mocks.highlight).not.toHaveBeenCalled();
});

it("still prepares and highlights a normal file for the impending visit", async () => {
  const prepare = vi.spyOn(document, "prepareSourceFileDocument");
  await preview("const value = 1;\n");
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(mocks.highlight).toHaveBeenCalledWith({
    path: "large.ts",
    contents: "const value = 1;\n",
    theme: "light",
  });
});
