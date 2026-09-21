import * as NodeFS from "node:fs";
import { describe, expect, it } from "vite-plus/test";

const threadRouteSource = NodeFS.readFileSync(
  new URL("../threads/ThreadRouteScreen.tsx", import.meta.url),
  "utf8",
);
const newTaskSource = NodeFS.readFileSync(
  new URL("../threads/NewTaskDraftScreen.tsx", import.meta.url),
  "utf8",
);
const threadDetailSource = NodeFS.readFileSync(
  new URL("../threads/ThreadDetailScreen.tsx", import.meta.url),
  "utf8",
);

describe("mobile scenery mount contract", () => {
  it("keeps the wallpaper behind threads and the new-task sheet", () => {
    expect(threadRouteSource).toContain("<SceneryBackdrop threadKey={routeThreadIdentity} />");
    expect(newTaskSource).toContain("<SceneryBackdrop threadKey={null} />");
    expect(threadDetailSource).toContain("useSceneryChromeActive");
    expect(threadDetailSource).toContain("sceneryChrome");
    expect(threadDetailSource).toContain('"absolute inset-0"');
  });
});
