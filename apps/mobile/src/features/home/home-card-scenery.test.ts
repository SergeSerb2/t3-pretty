import { EnvironmentId, ThreadId, type ThreadSceneryAssignment } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import type { SceneryAssignment, SceneryPhoto } from "../scenery/sceneryLogic";
import { resolveHomeCardSceneryThumb } from "./home-card-scenery";

const environmentId = EnvironmentId.make("environment-1");
const threadId = ThreadId.make("thread-1");
const threadKey = `${environmentId}:${threadId}`;

function photo(id: string): SceneryPhoto {
  return {
    id,
    name: `Place ${id}`,
    averageColorHex: null,
    heroURL: `https://images.example/${id}/hero`,
    thumbURL: `https://images.example/${id}/thumb`,
    rawURL: null,
    downloadLocationURL: null,
    photographerName: "Photographer",
    photographerProfileURL: null,
  };
}

function synced(id: string, photoSetId?: string): ThreadSceneryAssignment {
  const { id: photoId, ...fields } = photo(id);
  return { ...fields, photoId, assignedAt: "2026-10-04T00:00:00.000Z", photoSetId };
}

function scenery(assignments: Record<string, SceneryAssignment> = {}) {
  return {
    photoSetId: "world-scenery" as const,
    assignments,
    // The provider falls back to a hash pick when nothing is assigned.
    photoForThreadKey: (key: string) => photo(assignments[key]?.photoId ?? "hash-fallback"),
  };
}

describe("resolveHomeCardSceneryThumb", () => {
  it("shows the photo synced to the thread", () => {
    expect(
      resolveHomeCardSceneryThumb(
        { environmentId, id: threadId, scenery: synced("synced", "world-scenery") },
        scenery({ [threadKey]: { photoId: "local", name: "Local", assignedAt: 1 } }),
      ),
    ).toBe("https://images.example/synced/thumb");
  });

  it("falls back to this device's pick when the synced photo is from another catalog", () => {
    expect(
      resolveHomeCardSceneryThumb(
        { environmentId, id: threadId, scenery: synced("synced", "night-sky") },
        scenery({ [threadKey]: { photoId: "local", name: "Local", assignedAt: 1 } }),
      ),
    ).toBe("https://images.example/local/thumb");
  });

  it("shows nothing when this device's pick has left the catalog", () => {
    expect(
      resolveHomeCardSceneryThumb(
        { environmentId, id: threadId, scenery: null },
        {
          ...scenery({ [threadKey]: { photoId: "retired", name: "Retired", assignedAt: 1 } }),
          photoForThreadKey: () => photo("hash-fallback"),
        },
      ),
    ).toBeNull();
  });

  it("shows nothing for a thread without a photo instead of the hash fallback", () => {
    expect(
      resolveHomeCardSceneryThumb({ environmentId, id: threadId, scenery: null }, scenery()),
    ).toBeNull();
    expect(
      resolveHomeCardSceneryThumb(
        { environmentId, id: threadId, scenery: null },
        scenery({
          [threadKey]: { photoId: "local", name: "Local", assignedAt: 1, photoSetId: "night-sky" },
        }),
      ),
    ).toBeNull();
  });
});
