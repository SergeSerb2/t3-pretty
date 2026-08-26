import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import {
  appendDictationSegment,
  cleanupDictation,
  fetchDictationStatus,
  formatDictationInsertion,
  replaceDictationInsertion,
  transcribeDictationAudio,
} from "@t3tools/client-runtime/state/dictation";
import { File } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

import { runtime } from "../../lib/runtime";

const CHUNK_DURATION_MS = 5_000;
const CONTEXT_LENGTH = 8_000;

type DictationPhase = "idle" | "recording" | "processing";
type ExpoAudio = typeof import("expo-audio");
type ExpoAudioRecorder = InstanceType<ExpoAudio["AudioModule"]["AudioRecorder"]>;
type RecordingPreset = ExpoAudio["RecordingPresets"]["HIGH_QUALITY"];

interface DictationSession {
  readonly prepared: PreparedConnection;
  readonly start: number;
  readonly before: string;
  readonly after: string;
  readonly makeRecorder: () => ExpoAudioRecorder;
  readonly setAudioModeAsync: ExpoAudio["setAudioModeAsync"];
  recorder: ExpoAudioRecorder | null;
  transcript: string;
  insertion: string;
  timer: ReturnType<typeof setTimeout> | null;
  queue: Promise<void>;
  stopRequested: boolean;
  stoppingChunk: boolean;
  finalizing: boolean;
  error: unknown;
  cancelled: boolean;
  closed: boolean;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Voice dictation failed. Please try again.";
}

function nativeRecordingOptions(preset: RecordingPreset) {
  const { ios, android, web, ...common } = preset;
  return {
    ...common,
    isMeteringEnabled: preset.isMeteringEnabled ?? false,
    ...(Platform.OS === "ios" ? ios : Platform.OS === "android" ? android : web),
  };
}

export function useNativeDictation(input: {
  readonly enabled: boolean;
  readonly prepared: PreparedConnection | null;
  readonly value: string;
  readonly cursor: number;
  readonly onChangeValue: (value: string) => void;
  readonly onChangeCursor: (cursor: number) => void;
  readonly reportError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const sessionRef = useRef<DictationSession | null>(null);
  const mountedRef = useRef(true);
  const valueRef = useRef(input.value);
  const inputRef = useRef(input);
  if (sessionRef.current === null) valueRef.current = input.value;
  inputRef.current = input;

  const releaseCapture = useCallback(async (session: DictationSession) => {
    if (session.timer !== null) clearTimeout(session.timer);
    session.timer = null;
    const recorder = session.recorder;
    session.recorder = null;
    if (recorder) {
      if (recorder.isRecording) await recorder.stop().catch(() => undefined);
      recorder.release();
    }
    await session.setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
  }, []);

  const closeSession = useCallback(
    async (session: DictationSession) => {
      if (session.closed) return;
      session.closed = true;
      await releaseCapture(session);
      if (sessionRef.current === session) sessionRef.current = null;
      if (mountedRef.current) setPhase("idle");
    },
    [releaseCapture],
  );

  const replaceInsertion = useCallback((session: DictationSession, next: string): boolean => {
    if (session.cancelled || session.closed) return false;
    const replacement = replaceDictationInsertion({
      value: valueRef.current,
      start: session.start,
      before: session.before,
      after: session.after,
      previous: session.insertion,
      next,
    });
    if (!replacement) return false;
    valueRef.current = replacement.value;
    inputRef.current.onChangeValue(replacement.value);
    inputRef.current.onChangeCursor(replacement.cursor);
    session.insertion = next;
    return true;
  }, []);

  const finishSession = useCallback(
    async (session: DictationSession) => {
      if (session.finalizing || session.closed) return;
      session.finalizing = true;
      if (mountedRef.current) setPhase("processing");
      try {
        await releaseCapture(session);
        await session.queue;
        if (session.cancelled || session.closed) return;
        if (session.error) {
          inputRef.current.reportError(errorMessage(session.error));
          return;
        }
        if (session.transcript) {
          try {
            const result = await runtime.runPromise(
              cleanupDictation({
                prepared: session.prepared,
                transcript: session.transcript,
                before: session.before.slice(-CONTEXT_LENGTH),
                after: session.after.slice(0, CONTEXT_LENGTH),
              }),
            );
            if (
              !session.cancelled &&
              !session.closed &&
              !replaceInsertion(
                session,
                formatDictationInsertion({
                  before: session.before,
                  after: session.after,
                  transcript: result.text,
                }),
              )
            ) {
              inputRef.current.reportError("The composer changed; the raw transcript was kept.");
            }
          } catch {
            if (!session.cancelled && !session.closed) {
              inputRef.current.reportError("Voice cleanup failed; the raw transcript was kept.");
            }
          }
        }
      } finally {
        await closeSession(session);
      }
    },
    [closeSession, releaseCapture, replaceInsertion],
  );

  const transcribeFile = useCallback(
    async (session: DictationSession, uri: string) => {
      const file = new File(uri);
      let audioBase64: string;
      try {
        audioBase64 = await file.base64();
      } finally {
        try {
          file.delete();
        } catch {
          // The platform also reclaims recorder cache files; deletion is best effort.
        }
      }
      if (session.cancelled || session.closed) return;
      const result = await runtime.runPromise(
        transcribeDictationAudio({
          prepared: session.prepared,
          audioBase64,
          mimeType: "audio/m4a",
        }),
      );
      if (session.cancelled || session.closed) return;
      session.transcript = appendDictationSegment(session.transcript, result.text);
      const insertion = formatDictationInsertion({
        before: session.before,
        after: session.after,
        transcript: session.transcript,
      });
      if (!replaceInsertion(session, insertion)) {
        throw new Error("The composer changed while dictation was running.");
      }
    },
    [replaceInsertion],
  );

  const beginChunkRef = useRef<(session: DictationSession) => Promise<void>>(async () => {});
  const stopChunkRef = useRef<(session: DictationSession) => Promise<void>>(async () => {});

  beginChunkRef.current = async (session) => {
    if (session.stopRequested || session.cancelled || session.closed) {
      await finishSession(session);
      return;
    }
    try {
      const recorder = session.makeRecorder();
      session.recorder = recorder;
      await recorder.prepareToRecordAsync();
      if (session.stopRequested || session.cancelled || session.closed) {
        await finishSession(session);
        return;
      }
      recorder.record();
      session.timer = setTimeout(() => void stopChunkRef.current(session), CHUNK_DURATION_MS);
    } catch (error) {
      session.error = error;
      session.stopRequested = true;
      await finishSession(session);
    }
  };

  stopChunkRef.current = async (session) => {
    if (session.stoppingChunk || session.finalizing || session.closed) return;
    session.stoppingChunk = true;
    if (session.timer !== null) clearTimeout(session.timer);
    session.timer = null;
    const recorder = session.recorder;
    if (!recorder) {
      if (!session.stopRequested) session.error = new Error("Voice recorder is unavailable.");
      session.stopRequested = true;
      session.stoppingChunk = false;
      await finishSession(session);
      return;
    }
    session.recorder = null;
    let uri: string | null = null;
    try {
      await recorder.stop();
      if (!session.closed) uri = recorder.uri;
      if (!uri && !session.closed) {
        session.error = new Error("Voice recorder produced no audio file.");
        session.stopRequested = true;
      } else if (uri && !session.error) {
        const audioUri = uri;
        session.queue = session.queue.then(async () => {
          if (session.error || session.cancelled || session.closed) return;
          try {
            await transcribeFile(session, audioUri);
          } catch (error) {
            if (session.cancelled || session.closed) return;
            session.error = error;
            session.stopRequested = true;
            if (session.recorder?.isRecording) void stopChunkRef.current(session);
          }
        });
        void session.queue.then(() => {
          if (session.error && !session.closed) void finishSession(session);
        });
      }
    } catch (error) {
      session.error = error;
      session.stopRequested = true;
    } finally {
      recorder.release();
      session.stoppingChunk = false;
    }
    if (session.stopRequested || session.error) await finishSession(session);
    else await beginChunkRef.current(session);
  };

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.stopRequested) return;
    session.stopRequested = true;
    setPhase("processing");
    void stopChunkRef.current(session);
  }, []);

  const start = useCallback(async () => {
    const current = inputRef.current;
    if (!current.enabled || !current.prepared || sessionRef.current) return;
    let session: DictationSession | null = null;
    try {
      const status = await runtime.runPromise(fetchDictationStatus(current.prepared));
      if (!status.available) {
        current.reportError(
          status.reason === "groq_api_key_missing"
            ? "Add GROQ_API_KEY to the connected host to use voice dictation."
            : "Voice dictation is available only in internal builds.",
        );
        return;
      }
      if (!inputRef.current.enabled || inputRef.current.prepared !== current.prepared) return;
      const audio = await import("expo-audio");
      if (!inputRef.current.enabled || inputRef.current.prepared !== current.prepared) return;
      const permission = await audio.requestRecordingPermissionsAsync();
      if (!permission.granted) {
        current.reportError("Microphone access is required for voice dictation.");
        return;
      }
      if (!inputRef.current.enabled || inputRef.current.prepared !== current.prepared) return;
      const recordingOptions = nativeRecordingOptions(audio.RecordingPresets.HIGH_QUALITY);
      const cursor = Math.max(0, Math.min(valueRef.current.length, inputRef.current.cursor));
      session = {
        prepared: current.prepared,
        start: cursor,
        before: valueRef.current.slice(0, cursor),
        after: valueRef.current.slice(cursor),
        makeRecorder: () => new audio.AudioModule.AudioRecorder(recordingOptions),
        setAudioModeAsync: audio.setAudioModeAsync,
        recorder: null,
        transcript: "",
        insertion: "",
        timer: null,
        queue: Promise.resolve(),
        stopRequested: false,
        stoppingChunk: false,
        finalizing: false,
        error: null,
        cancelled: false,
        closed: false,
      };
      sessionRef.current = session;
      setPhase("recording");
      await audio.setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      if (session.cancelled || session.closed) {
        await audio.setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
        return;
      }
      await beginChunkRef.current(session);
    } catch (error) {
      if (session) await closeSession(session);
      current.reportError(errorMessage(error));
      if (mountedRef.current) setPhase("idle");
    }
  }, [closeSession]);

  useEffect(() => {
    if (!input.enabled && phase === "recording") stop();
  }, [input.enabled, phase, stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (!session) return;
      session.cancelled = true;
      session.stopRequested = true;
      if (session.timer !== null) clearTimeout(session.timer);
      void closeSession(session);
    };
  }, [closeSession]);

  return {
    phase,
    active: phase !== "idle",
    toggle: phase === "recording" ? stop : start,
  } as const;
}
