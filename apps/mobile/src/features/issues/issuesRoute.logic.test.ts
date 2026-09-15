import { EnvironmentId, type Issue } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mergeIssueEnvironments,
  sentryAssigneeHint,
  shouldShowLinearCreateEditor,
} from "./issuesRoute.logic";

const localId = EnvironmentId.make("environment-local");
const remoteId = EnvironmentId.make("environment-remote");

const sentryIssue = {
  provider: "sentry",
  id: "123",
  identifier: "PROJ-1",
  title: "Boom",
} as Issue;

describe("mergeIssueEnvironments", () => {
  it("includes a catalog local environment even when no remotes are saved", () => {
    expect(
      mergeIssueEnvironments(
        [{ environmentId: localId, label: "This Mac" }],
        [],
      ).map((environment) => environment.environmentId),
    ).toEqual([localId]);
  });

  it("keeps saved remotes and catalog locals in one picker list", () => {
    const environments = mergeIssueEnvironments(
      [{ environmentId: localId, label: "This Mac" }],
      [{ environmentId: remoteId, environmentLabel: "Office desktop" }],
    );
    expect(environments.map((environment) => environment.environmentId)).toEqual([
      remoteId,
      localId,
    ]);
  });

  it("does not duplicate an environment present in both sources", () => {
    expect(
      mergeIssueEnvironments(
        [{ environmentId: remoteId, label: "Office desktop" }],
        [{ environmentId: remoteId, environmentLabel: "Stale label" }],
      ),
    ).toEqual([{ environmentId: remoteId, label: "Office desktop" }]);
  });
});

describe("shouldShowLinearCreateEditor", () => {
  it("keeps a Sentry follow-up pending until Linear is connected", () => {
    expect(shouldShowLinearCreateEditor({ source: sentryIssue }, [])).toBe(false);
    expect(
      shouldShowLinearCreateEditor({ source: sentryIssue }, [{ provider: "sentry" }]),
    ).toBe(false);
  });

  it("opens Linear create once Linear is connected, including after a blank new issue", () => {
    expect(
      shouldShowLinearCreateEditor({ source: sentryIssue }, [
        { provider: "sentry" },
        { provider: "linear" },
      ]),
    ).toBe(true);
    expect(shouldShowLinearCreateEditor({}, [{ provider: "linear" }])).toBe(true);
  });

  it("does not open the editor while connections are loading or create is idle", () => {
    expect(shouldShowLinearCreateEditor({ source: sentryIssue }, null)).toBe(false);
    expect(shouldShowLinearCreateEditor(null, [{ provider: "linear" }])).toBe(false);
  });
});

describe("sentryAssigneeHint", () => {
  it("documents Sentry assignedTo as user or team ids", () => {
    expect(sentryAssigneeHint).toContain("user:ID");
    expect(sentryAssigneeHint).toContain("team:ID");
    expect(sentryAssigneeHint).not.toContain("email");
  });
});
