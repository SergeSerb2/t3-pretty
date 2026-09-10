import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import {
  appendDictationSegment,
  cleanupDictation,
  fetchDictationStatus,
  formatDictationInsertion,
  replaceDictationInsertion,
  transcribeDictationAudio,
} from "@t3tools/client-runtime/state/dictation";
import type { DictationAudioMimeType } from "@t3tools/contracts";
import { useCallback, useEffect, useRef, useState } from "react";

import { runtime } from "../../lib/runtime";

const CHUNK_DURATION_MS = 4_000;
const RECORDING_LIMIT_MS = 5 * 60_000;
const CONTEXT_LENGTH = 8_000;
const RECORDING_FORMATS = [
  { mimeType: "audio/webm;codecs=opus", apiMimeType: "audio/webm" as const },
  { mimeType: "audio/mp4", apiMimeType: "audio/mp4" as const },
  { mimeType: "audio/webm", apiMimeType: "audio/webm" as const },
];

export type DictationPhase = "idle" | "preparing" | "recording" | "processing";

interface DictationSession {
  readonly ownerKey: string;
  readonly prepared: PreparedConnection;
  readonly abort: AbortController;
  readonly startedAt: number;
  readonly stream: MediaStream;
  readonly start: number;
  readonly before: string;
  readonly after: string;
  transcript: string;
  insertion: string;
  recorder: MediaRecorder | null;
  timer: number | null;
  queue: Promise<void>;
  stopRequested: boolean;
  finalizing: boolean;
  error: unknown;
  cancelled: boolean;
  closed: boolean;
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return "Microphone access was denied. Allow T3 Pretty to use your microphone in system or browser settings.";
  }
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Voice dictation failed. Please try again.";
}

function recordingFormat(): {
  readonly mimeType: string;
  readonly apiMimeType: DictationAudioMimeType;
} {
  return (
    RECORDING_FORMATS.find(({ mimeType }) => MediaRecorder.isTypeSupported(mimeType)) ??
    RECORDING_FORMATS[2]!
  );
}

function blobBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener(
      "error",
      () => reject(reader.error ?? new Error("Could not read recorded audio.")),
      { once: true },
    );
    reader.addEventListener("load", () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Could not read recorded audio."));
        return;
      }
      resolve(result.slice(result.indexOf(",") + 1));
    });
    reader.readAsDataURL(blob);
  });
}

export function useBrowserDictation(input: {
  readonly ownerKey: string;
  readonly enabled: boolean;
  /** When false, refuse to begin a new capture. Does not cancel an in-flight session. */
  readonly canStart?: boolean;
  readonly prepared: PreparedConnection | null;
  readonly readComposer: () => { readonly value: string; readonly cursor: number };
  readonly replaceInsertion: (start: number, previous: string, next: string) => boolean;
  readonly reportError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const [hostLabel, setHostLabel] = useState<string | null>(null);
  const sessionRef = useRef<DictationSession | null>(null);
  const startingRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const inputRef = useRef(input);
  inputRef.current = input;

  const releaseCapture = useCallback((session: DictationSession) => {
    if (session.timer !== null) window.clearTimeout(session.timer);
    session.timer = null;
    const recorder = session.recorder;
    session.recorder = null;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state === "recording") recorder.stop();
    }
    for (const track of session.stream.getTracks()) track.stop();
  }, []);

  const closeSession = useCallback(
    (session: DictationSession) => {
      if (session.closed) return;
      session.closed = true;
      session.abort.abort();
      releaseCapture(session);
      if (sessionRef.current === session) sessionRef.current = null;
      if (mountedRef.current) setPhase("idle");
    },
    [releaseCapture],
  );

  const replaceSessionInsertion = useCallback((session: DictationSession, next: string) => {
    const current = inputRef.current;
    if (
      current.ownerKey !== session.ownerKey ||
      replaceDictationInsertion({
        value: current.readComposer().value,
        start: session.start,
        before: session.before,
        after: session.after,
        previous: session.insertion,
        next,
      }) === null
    ) {
      return false;
    }
    return current.replaceInsertion(session.start, session.insertion, next);
  }, []);

  const finishSession = useCallback(
    async (session: DictationSession) => {
      if (session.finalizing || session.closed) return;
      session.finalizing = true;
      if (mountedRef.current) setPhase("processing");
      releaseCapture(session);
      try {
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
              { signal: session.abort.signal },
            );
            if (!session.cancelled && !session.closed) {
              const insertion = formatDictationInsertion({
                before: session.before,
                after: session.after,
                transcript: result.text,
              });
              if (!replaceSessionInsertion(session, insertion)) {
                inputRef.current.reportError("The composer changed; the raw transcript was kept.");
              }
            }
          } catch {
            if (!session.cancelled && !session.closed) {
              inputRef.current.reportError("Voice cleanup failed; the raw transcript was kept.");
            }
          }
        }
      } finally {
        closeSession(session);
      }
    },
    [closeSession, releaseCapture, replaceSessionInsertion],
  );

  const transcribeChunk = useCallback(
    async (session: DictationSession, blob: Blob, apiMimeType: DictationAudioMimeType) => {
      const audioBase64 = await blobBase64(blob);
      if (session.cancelled || session.closed) return;
      const result = await runtime.runPromise(
        transcribeDictationAudio({
          prepared: session.prepared,
          audioBase64,
          mimeType: apiMimeType,
        }),
        { signal: session.abort.signal },
      );
      if (session.cancelled || session.closed) return;
      session.transcript = appendDictationSegment(session.transcript, result.text);
      const insertion = formatDictationInsertion({
        before: session.before,
        after: session.after,
        transcript: session.transcript,
      });
      if (!replaceSessionInsertion(session, insertion)) {
        throw new Error("The composer changed while dictation was running.");
      }
      session.insertion = insertion;
    },
    [replaceSessionInsertion],
  );

  const beginChunkRef = useRef<(session: DictationSession) => void>(() => {});
  beginChunkRef.current = (session) => {
    if (session.stopRequested || session.cancelled || session.closed) {
      void finishSession(session);
      return;
    }
    try {
      const format = recordingFormat();
      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(session.stream, {
        mimeType: format.mimeType,
        audioBitsPerSecond: 48_000,
      });
      session.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (session.closed) return;
        if (session.timer !== null) window.clearTimeout(session.timer);
        session.timer = null;
        if (session.recorder === recorder) session.recorder = null;
        if (Date.now() - session.startedAt >= RECORDING_LIMIT_MS) session.stopRequested = true;
        const blob = new Blob(chunks, { type: format.mimeType });
        if (blob.size > 0 && !session.error) {
          session.queue = session.queue.then(async () => {
            if (session.error || session.cancelled || session.closed) return;
            try {
              await transcribeChunk(session, blob, format.apiMimeType);
            } catch (error) {
              if (session.cancelled || session.closed) return;
              session.error = error;
              session.stopRequested = true;
              if (session.recorder?.state === "recording") session.recorder.stop();
            }
          });
          void session.queue.then(() => {
            if (session.error && !session.closed) void finishSession(session);
          });
        } else if (!session.stopRequested && !session.error) {
          session.error = new Error("Voice recorder produced no audio.");
          session.stopRequested = true;
        }
        if (session.stopRequested || session.error) {
          void finishSession(session);
        } else {
          beginChunkRef.current(session);
        }
      };
      recorder.onerror = () => {
        session.error = new Error("The microphone stopped recording. Please try again.");
        session.stopRequested = true;
        void finishSession(session);
      };
      recorder.start();
      session.timer = window.setTimeout(() => {
        if (recorder.state === "recording") recorder.stop();
      }, CHUNK_DURATION_MS);
    } catch (error) {
      session.error = error;
      session.stopRequested = true;
      void finishSession(session);
    }
  };

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.stopRequested) return;
    session.stopRequested = true;
    setPhase("processing");
    if (session.recorder?.state === "recording") session.recorder.stop();
    else void finishSession(session);
  }, [finishSession]);

  const start = useCallback(async () => {
    const current = inputRef.current;
    if (!current.enabled || current.canStart === false || sessionRef.current || startingRef.current)
      return;
    if (!current.prepared) {
      current.reportError(
        "Set GROQ_API_KEY on a connected internal host to use dictation on all your devices.",
      );
      return;
    }
    const abort = new AbortController();
    startingRef.current = abort;
    setHostLabel(current.prepared.label);
    setPhase("preparing");
    const snapshot = current.readComposer();
    let stream: MediaStream | null = null;
    try {
      const status = await runtime.runPromise(fetchDictationStatus(current.prepared), {
        signal: abort.signal,
      });
      if (
        abort.signal.aborted ||
        !mountedRef.current ||
        !inputRef.current.enabled ||
        inputRef.current.ownerKey !== current.ownerKey
      ) {
        return;
      }
      if (!status.available) {
        current.reportError(
          status.reason === "groq_api_key_missing"
            ? "Set GROQ_API_KEY on a connected internal host to use dictation on all your devices."
            : "Voice dictation is available only in internal builds.",
        );
        return;
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support audio recording.");
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Microphone access requires HTTPS or the T3 Pretty desktop app.");
      }
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      if (
        abort.signal.aborted ||
        !mountedRef.current ||
        !inputRef.current.enabled ||
        inputRef.current.ownerKey !== current.ownerKey
      ) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      if (inputRef.current.readComposer().value !== snapshot.value) {
        throw new Error("The composer changed before recording started. Please try again.");
      }
      const session: DictationSession = {
        ownerKey: current.ownerKey,
        prepared: current.prepared,
        abort,
        startedAt: Date.now(),
        stream,
        start: snapshot.cursor,
        before: snapshot.value.slice(0, snapshot.cursor),
        after: snapshot.value.slice(snapshot.cursor),
        transcript: "",
        insertion: "",
        recorder: null,
        timer: null,
        queue: Promise.resolve(),
        stopRequested: false,
        finalizing: false,
        error: null,
        cancelled: false,
        closed: false,
      };
      sessionRef.current = session;
      stream = null;
      setPhase("recording");
      beginChunkRef.current(session);
    } catch (error) {
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (abort.signal.aborted) return;
      const session = sessionRef.current;
      if (session) {
        session.cancelled = true;
        closeSession(session);
      }
      if (mountedRef.current) current.reportError(errorMessage(error));
      if (mountedRef.current) setPhase("idle");
    } finally {
      if (startingRef.current === abort) {
        startingRef.current = null;
        if (!sessionRef.current && mountedRef.current) setPhase("idle");
      }
    }
  }, [closeSession]);

  const toggle = useCallback(() => {
    if (sessionRef.current) return stop();
    return start();
  }, [start, stop]);

  const cancel = useCallback(() => {
    startingRef.current?.abort();
    startingRef.current = null;
    const session = sessionRef.current;
    if (session) {
      session.cancelled = true;
      replaceSessionInsertion(session, "");
      closeSession(session);
    }
    if (mountedRef.current) setPhase("idle");
  }, [closeSession, replaceSessionInsertion]);

  useEffect(() => {
    if (!input.enabled) cancel();
  }, [cancel, input.enabled]);

  const previousOwnerRef = useRef(input.ownerKey);
  useEffect(() => {
    if (previousOwnerRef.current === input.ownerKey) return;
    previousOwnerRef.current = input.ownerKey;
    startingRef.current?.abort();
    startingRef.current = null;
    const session = sessionRef.current;
    if (session) {
      session.cancelled = true;
      closeSession(session);
    }
    setPhase("idle");
  }, [closeSession, input.ownerKey]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startingRef.current?.abort();
      const session = sessionRef.current;
      if (!session) return;
      session.cancelled = true;
      session.stopRequested = true;
      if (session.recorder?.state === "recording") session.recorder.stop();
      closeSession(session);
    };
  }, [closeSession]);

  return {
    phase,
    active: phase !== "idle",
    hostLabel: phase === "idle" ? (input.prepared?.label ?? null) : hostLabel,
    cancel,
    toggle,
  } as const;
}
