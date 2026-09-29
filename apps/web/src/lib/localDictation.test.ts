import { describe, expect, it } from "vite-plus/test";

import {
  localDictationHint,
  resolveLocalDictationEngine,
  transcriptFromSpeechRecognitionEvent,
} from "./localDictation";

describe("local dictation availability", () => {
  it("uses macOS Speech.framework in the desktop app and hides the control elsewhere in Electron", () => {
    expect(
      resolveLocalDictationEngine({
        desktopBridge: { startDictation: async () => undefined, getClientPlatform: () => "darwin" },
        speechRecognitionAvailable: true,
      }),
    ).toBe("mac-desktop");
    expect(
      resolveLocalDictationEngine({
        desktopBridge: { startDictation: async () => undefined, getClientPlatform: () => "win32" },
        speechRecognitionAvailable: true,
      }),
    ).toBeNull();
    expect(
      resolveLocalDictationEngine({
        desktopBridge: { getClientPlatform: () => "darwin" },
        speechRecognitionAvailable: true,
      }),
    ).toBeNull();
  });

  it("uses the browser Speech API when there is no desktop shell", () => {
    expect(
      resolveLocalDictationEngine({
        speechRecognitionAvailable: true,
      }),
    ).toBe("web-speech");
    expect(
      resolveLocalDictationEngine({
        speechRecognitionAvailable: false,
      }),
    ).toBeNull();
  });

  it("labels the engine and concatenates live recognition results", () => {
    expect(localDictationHint("mac-desktop")).toBe("macOS speech recognition");
    expect(localDictationHint("web-speech")).toBe("This browser's speech recognition");
    expect(
      transcriptFromSpeechRecognitionEvent({
        results: [
          { 0: { transcript: "hello " }, length: 1, isFinal: true },
          { 0: { transcript: "world" }, length: 1, isFinal: false },
        ],
      }),
    ).toBe("hello world");
  });
});
