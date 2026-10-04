import { describe, expect, it } from "@effect/vitest";

import {
  MAC_DICTATION_HELPER_NAME,
  parseMacDictationEvent,
  resolveMacDictationHelperCandidates,
} from "./MacDictation.ts";

describe("macOS dictation helper paths", () => {
  it("prefers the helper beside the packaged executable", () => {
    expect(
      resolveMacDictationHelperCandidates({
        platform: "darwin",
        isPackaged: true,
        execDir: "/Applications/T3 Pretty.app/Contents/MacOS",
        rootDir: "/repo",
        processArch: "arm64",
        resourcesPath: "/Applications/T3 Pretty.app/Contents/Resources",
      }),
    ).toEqual([
      `/Applications/T3 Pretty.app/Contents/MacOS/${MAC_DICTATION_HELPER_NAME}`,
      `/Applications/T3 Pretty.app/Contents/Resources/mac-dictation/${MAC_DICTATION_HELPER_NAME}`,
    ]);
  });

  it("uses the source-tree build during development", () => {
    expect(
      resolveMacDictationHelperCandidates({
        platform: "darwin",
        isPackaged: false,
        execDir: "/repo/node_modules/electron/dist/Electron.app/Contents/MacOS",
        rootDir: "/repo",
        processArch: "arm64",
        resourcesPath: "/repo/apps/desktop/resources",
      }),
    ).toEqual([
      `/repo/native/mac-dictation/build/arm64/${MAC_DICTATION_HELPER_NAME}`,
      `/repo/apps/desktop/resources/mac-dictation/${MAC_DICTATION_HELPER_NAME}`,
    ]);
  });

  it("is inert off macOS", () => {
    expect(
      resolveMacDictationHelperCandidates({
        platform: "linux",
        isPackaged: false,
        execDir: "/usr/bin",
        rootDir: "/repo",
        processArch: "x64",
        resourcesPath: "/repo/resources",
      }),
    ).toEqual([]);
  });
});

describe("macOS dictation helper events", () => {
  it("parses helper protocol lines and ignores junk", () => {
    expect(parseMacDictationEvent("")).toBeNull();
    expect(parseMacDictationEvent("{")).toBeNull();
    expect(parseMacDictationEvent('{"type":"ready"}')).toEqual({ type: "ready" });
    expect(parseMacDictationEvent('{"type":"transcript","text":"hello world"}')).toEqual({
      type: "transcript",
      text: "hello world",
    });
    expect(parseMacDictationEvent('{"type":"error"}')).toEqual({
      type: "error",
      message: "macOS speech recognition failed.",
    });
    expect(parseMacDictationEvent('{"type":"ended"}')).toEqual({ type: "ended" });
  });
});
