import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("../ProjectFavicon", () => ({
  ProjectFavicon: () => null,
}));

import type { SidebarProjectSnapshot } from "../../sidebarProjectGrouping";
import { SidebarProvider } from "../ui/sidebar";
import { SidebarProjectRail } from "./SidebarProjectRail";

function project(projectKey: string, displayName: string): SidebarProjectSnapshot {
  return {
    projectKey,
    displayName,
    title: displayName,
    workspaceRoot: `/tmp/${projectKey}`,
    groupedProjectCount: 1,
    remoteEnvironmentLabels: [],
  } as unknown as SidebarProjectSnapshot;
}

describe("SidebarProjectRail live counts", () => {
  it("replaces shortcut indexes with working and monitoring counts", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarProjectRail
          projects={[project("alpha", "Alpha"), project("beta", "Beta"), project("gamma", "Gamma")]}
          selectedProjectKey={null}
          onSelectProject={() => undefined}
          activityByProjectKey={
            new Map([
              ["alpha", { working: 2, monitoring: 1 }],
              ["beta", { working: 0, monitoring: 4 }],
            ])
          }
          folders={{
            folders: [{ id: "work", name: "Work", collapsed: true }],
            assignments: { beta: "work" },
          }}
        />
      </SidebarProvider>,
    );

    expect(html).toContain("Show Alpha threads, 2 working, 1 monitoring");
    expect(html).toContain("Expand Work, 4 monitoring");
    expect(html).toContain("Show Gamma threads");
    expect(html).not.toContain("Show Gamma threads,");
    expect(html).toContain(">3<");
    expect(html).toContain(">4<");
    expect(html).toContain("bg-sky-700");
    expect(html).not.toContain("rounded-sm border");
  });
});
