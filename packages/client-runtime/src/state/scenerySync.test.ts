import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  mayPublishThreadScenery,
  resolveSharedSceneryPhotoSet,
  serverSceneryMatchesPhotoSet,
  shouldPublishLocalSceneryPhotoSet,
} from "./scenerySync.ts";

// Match Hermes: these ES2023 array methods are absent on mobile, and
// resolveSharedSceneryPhotoSet runs from SceneryProvider on every iOS launch.
beforeEach(() => {
  const methods = ["toSorted", "toReversed", "toSpliced"] as const;
  const descriptors = methods.map((method) =>
    Object.getOwnPropertyDescriptor(Array.prototype, method),
  );
  for (const method of methods) Reflect.deleteProperty(Array.prototype, method);
  return () => {
    for (const [index, method] of methods.entries()) {
      const descriptor = descriptors[index];
      if (descriptor) Reflect.defineProperty(Array.prototype, method, descriptor);
    }
  };
});

describe("resolveSharedSceneryPhotoSet", () => {
  const sources = [
    { environmentId: "env-b", syncEligible: true, sceneryPhotoSet: "night-cities" },
    { environmentId: "env-a", syncEligible: true, sceneryPhotoSet: "deep-forest" },
    { environmentId: "env-c", syncEligible: false, sceneryPhotoSet: "night-sky" },
  ];

  it("prefers the connected primary machine", () => {
    expect(resolveSharedSceneryPhotoSet({ primaryEnvironmentId: "env-b", sources })).toBe(
      "night-cities",
    );
  });

  it("uses another connected machine when the primary has not chosen a catalog", () => {
    expect(
      resolveSharedSceneryPhotoSet({
        primaryEnvironmentId: "env-primary",
        sources: [
          { environmentId: "env-primary", syncEligible: true, sceneryPhotoSet: null },
          ...sources,
        ],
      }),
    ).toBe("deep-forest");
  });

  it("returns null when nobody connected has published a catalog", () => {
    expect(
      resolveSharedSceneryPhotoSet({
        primaryEnvironmentId: null,
        sources: [{ environmentId: "env-a", syncEligible: true, sceneryPhotoSet: null }],
      }),
    ).toBeNull();
  });

  it("sorts connected catalogs without Array#toSorted when no primary is set", () => {
    expect(resolveSharedSceneryPhotoSet({ primaryEnvironmentId: null, sources })).toBe(
      "deep-forest",
    );
  });
});

describe("thread scenery publication", () => {
  it("lifts a non-default local catalog only while the account has none", () => {
    expect(
      shouldPublishLocalSceneryPhotoSet({
        sharedPhotoSetId: null,
        localPhotoSetId: "night-cities",
        defaultPhotoSetId: "world-scenery",
      }),
    ).toBe(true);
    expect(
      shouldPublishLocalSceneryPhotoSet({
        sharedPhotoSetId: null,
        localPhotoSetId: "world-scenery",
        defaultPhotoSetId: "world-scenery",
      }),
    ).toBe(false);
    expect(
      shouldPublishLocalSceneryPhotoSet({
        sharedPhotoSetId: "deep-forest",
        localPhotoSetId: "night-cities",
        defaultPhotoSetId: "world-scenery",
      }),
    ).toBe(false);
  });

  it("shows a server photo from the active catalog, including a legacy binding", () => {
    expect(serverSceneryMatchesPhotoSet(undefined, "night-cities")).toBe(true);
    expect(serverSceneryMatchesPhotoSet(null, "night-cities")).toBe(true);
    expect(serverSceneryMatchesPhotoSet("night-cities", "night-cities")).toBe(true);
    expect(serverSceneryMatchesPhotoSet("night-cities", "world-scenery")).toBe(false);
  });

  it("does not upload a local pick over a catalog this device has not adopted", () => {
    expect(
      mayPublishThreadScenery({ sharedPhotoSetId: null, localPhotoSetId: "night-cities" }),
    ).toBe(true);
    expect(
      mayPublishThreadScenery({
        sharedPhotoSetId: "night-cities",
        localPhotoSetId: "night-cities",
      }),
    ).toBe(true);
    expect(
      mayPublishThreadScenery({
        sharedPhotoSetId: "night-cities",
        localPhotoSetId: "world-scenery",
      }),
    ).toBe(false);
  });
});
