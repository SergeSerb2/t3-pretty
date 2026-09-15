import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { RelayConnectionTarget, type PreparedConnection } from "@t3tools/client-runtime/connection";
import { EnvironmentId, DICTATION_AUDIO_BASE64_MAX_LENGTH } from "@t3tools/contracts";

const mocks = vi.hoisted(() => ({
  readAudio: vi.fn<() => Promise<string>>(),
  runPromise: vi.fn(),
  fileSize: 100,
}));

vi.mock("expo-file-system", () => ({
  File: class {
    size = mocks.fileSize;
    base64 = mocks.readAudio;
  },
}));
vi.mock("../lib/runtime", () => ({
  runtime: { runPromise: mocks.runPromise },
}));

import { createGroqVoiceTranscriber } from "./groqVoiceTranscription";

const environmentId = EnvironmentId.make("shared-groq-host");
const prepared: PreparedConnection = {
  environmentId,
  label: "Shared Groq host",
  target: new RelayConnectionTarget({ environmentId, label: "Shared Groq host" }),
  httpBaseUrl: "https://shared-host.example.test",
  socketUrl: "wss://shared-host.example.test/ws",
  httpAuthorization: { _tag: "Bearer", token: "host-session" },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.fileSize = 100;
  mocks.readAudio.mockResolvedValue("YXVkaW8=");
  mocks.runPromise.mockResolvedValueOnce({ available: true, reason: null });
});
const options = () => ({ signal: new AbortController().signal });
const transcriber = () =>
  createGroqVoiceTranscriber({ prepared, before: "Please", after: "today." });

describe("Groq native transcription", () => {
  it("returns cleaned speech and preserves an intentionally empty cleanup result", async () => {
    const session = await transcriber().prepare(options());
    mocks.runPromise
      .mockResolvedValueOnce({ text: "um fix src/main.ts" })
      .mockResolvedValueOnce({ text: "Fix src/main.ts." });
    expect(await session.transcribe("file:///recording.m4a", options())).toBe("Fix src/main.ts.");
    mocks.runPromise.mockResolvedValueOnce({ text: "um uh" }).mockResolvedValueOnce({ text: "" });
    expect(await session.transcribe("file:///recording.m4a", options())).toBe("");
  });

  it("preserves speech when the cleanup service fails", async () => {
    const session = await transcriber().prepare(options());
    mocks.runPromise
      .mockResolvedValueOnce({ text: "raw transcript" })
      .mockRejectedValueOnce(new Error("Cleanup failed"));
    expect(await session.transcribe("file:///recording.m4a", options())).toBe("raw transcript");
  });

  it("does not upload audio after cancellation while reading the recording", async () => {
    const session = await transcriber().prepare(options());
    const abort = new AbortController();
    mocks.readAudio.mockImplementation(async () => {
      abort.abort();
      return "YXVkaW8=";
    });
    await expect(
      session.transcribe("file:///recording.m4a", { signal: abort.signal }),
    ).rejects.toMatchObject({ code: "cancelled" });
    expect(mocks.runPromise).toHaveBeenCalledTimes(1);
  });

  it("skips empty recordings and bounds memory before reading oversized audio", async () => {
    const session = await transcriber().prepare(options());
    mocks.readAudio.mockResolvedValueOnce("");
    expect(await session.transcribe("file:///empty.m4a", options())).toBe("");
    mocks.fileSize = DICTATION_AUDIO_BASE64_MAX_LENGTH;
    await expect(session.transcribe("file:///large.m4a", options())).rejects.toMatchObject({
      code: "transcription-failed",
    });
    expect(mocks.readAudio).toHaveBeenCalledTimes(1);
    expect(mocks.runPromise).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized audio after reading when Expo reports size 0", async () => {
    const session = await transcriber().prepare(options());
    mocks.fileSize = 0;
    mocks.readAudio.mockResolvedValueOnce("a".repeat(DICTATION_AUDIO_BASE64_MAX_LENGTH + 1));
    await expect(session.transcribe("file:///unknown-size.m4a", options())).rejects.toMatchObject({
      code: "transcription-failed",
    });
    expect(mocks.readAudio).toHaveBeenCalledTimes(1);
    expect(mocks.runPromise).toHaveBeenCalledTimes(1);
  });

  it("fails preparation before recording when the host no longer has Groq configured", async () => {
    mocks.runPromise
      .mockReset()
      .mockResolvedValueOnce({ available: false, reason: "groq_api_key_missing" });
    await expect(transcriber().prepare(options())).rejects.toMatchObject({ code: "unavailable" });
    expect(mocks.readAudio).not.toHaveBeenCalled();
  });
});
