import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import {
  appendDictationSegment,
  cleanupDictation,
  fetchDictationStatus,
  formatDictationInsertion,
  replaceDictationInsertion,
  transcribeDictationAudio,
} from "@t3tools/client-runtime/state/dictation";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { File } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";

import { runtime } from "../../lib/runtime";

const CHUNK_DURATION_MS = 5_000;
const CONTEXT_LENGTH = 8_000;

type DictationPhase = "idle" | "recording" | "processing";

interface DictationSession {
  readonly prepared: PreparedConnection;
  readonly start: number;
  readonly before: string;
  readonly after: string;
  transcript: string;
  insertion: string;
  timer: ReturnType<typeof setTimeout> | null;
  queue: Promise<void>;
  stopRequested: boolean;
  stoppingChunk: boolean;
  finalizing: boolean;
  error: unknown;
  cancelled: boolean;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Voice dictation failed. Please try again.";
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
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const sessionRef = useRef<DictationSession | null>(null);
  const mountedRef = useRef(true);
  const valueRef = useRef(input.value);
  const inputRef = useRef(input);
  valueRef.current = input.value;
  inputRef.current = input;

  const closeSession = useCallback(async (session: DictationSession) => {
    if (session.timer !== null) clearTimeout(session.timer);
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    if (sessionRef.current === session) sessionRef.current = null;
    if (mountedRef.current) setPhase("idle");
  }, []);

  const replaceInsertion = useCallback((session: DictationSession, next: string): boolean => {
    const replacement = replaceDictationInsertion({
      value: valueRef.current,
      start: session.start,
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
      if (session.finalizing) return;
      session.finalizing = true;
      if (mountedRef.current) setPhase("processing");
      await session.queue;
      if (session.cancelled) {
        await closeSession(session);
        return;
      }
      if (session.error) {
        inputRef.current.reportError(errorMessage(session.error));
        await closeSession(session);
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
          inputRef.current.reportError("Voice cleanup failed; the raw transcript was kept.");
        }
      }
      await closeSession(session);
    },
    [closeSession, replaceInsertion],
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
      const result = await runtime.runPromise(
        transcribeDictationAudio({
          prepared: session.prepared,
          audioBase64,
          mimeType: "audio/m4a",
        }),
      );
      if (session.cancelled) return;
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
    if (session.stopRequested || session.cancelled) {
      await finishSession(session);
      return;
    }
    try {
      await recorder.prepareToRecordAsync();
      if (session.stopRequested || session.cancelled) {
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
    if (session.stoppingChunk || session.finalizing) return;
    session.stoppingChunk = true;
    if (session.timer !== null) clearTimeout(session.timer);
    session.timer = null;
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri && !session.error) {
        session.queue = session.queue.then(async () => {
          if (session.error || session.cancelled) return;
          try {
            await transcribeFile(session, uri);
          } catch (error) {
            session.error = error;
            session.stopRequested = true;
            if (recorder.isRecording) void stopChunkRef.current(session);
            else void finishSession(session);
          }
        });
      }
    } catch (error) {
      session.error = error;
      session.stopRequested = true;
    } finally {
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
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        current.reportError("Microphone access is required for voice dictation.");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      const cursor = Math.max(0, Math.min(valueRef.current.length, current.cursor));
      const session: DictationSession = {
        prepared: current.prepared,
        start: cursor,
        before: valueRef.current.slice(0, cursor),
        after: valueRef.current.slice(cursor),
        transcript: "",
        insertion: "",
        timer: null,
        queue: Promise.resolve(),
        stopRequested: false,
        stoppingChunk: false,
        finalizing: false,
        error: null,
        cancelled: false,
      };
      sessionRef.current = session;
      setPhase("recording");
      await beginChunkRef.current(session);
    } catch (error) {
      current.reportError(errorMessage(error));
      if (mountedRef.current) setPhase("idle");
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      const session = sessionRef.current;
      if (!session) return;
      session.cancelled = true;
      session.stopRequested = true;
      if (session.timer !== null) clearTimeout(session.timer);
      if (recorder.isRecording) void recorder.stop();
      void setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    };
  }, [recorder]);

  return {
    phase,
    active: phase !== "idle",
    toggle: phase === "recording" ? stop : start,
  } as const;
}
