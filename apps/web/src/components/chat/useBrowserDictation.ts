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

const CHUNK_DURATION_MS = 5_000;
const CONTEXT_LENGTH = 8_000;
const RECORDING_FORMATS = [
  { mimeType: "audio/webm;codecs=opus", apiMimeType: "audio/webm" as const },
  { mimeType: "audio/mp4", apiMimeType: "audio/mp4" as const },
  { mimeType: "audio/webm", apiMimeType: "audio/webm" as const },
];

type DictationPhase = "idle" | "recording" | "processing";

interface DictationSession {
  readonly prepared: PreparedConnection;
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
  readonly enabled: boolean;
  readonly prepared: PreparedConnection | null;
  readonly readComposer: () => { readonly value: string; readonly cursor: number };
  readonly replaceInsertion: (start: number, previous: string, next: string) => boolean;
  readonly reportError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const sessionRef = useRef<DictationSession | null>(null);
  const startingRef = useRef(false);
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
      if (recorder.state === "recording") recorder.stop();
    }
    for (const track of session.stream.getTracks()) track.stop();
  }, []);

  const closeSession = useCallback(
    (session: DictationSession) => {
      if (session.closed) return;
      session.closed = true;
      releaseCapture(session);
      if (sessionRef.current === session) sessionRef.current = null;
      if (mountedRef.current) setPhase("idle");
    },
    [releaseCapture],
  );

  const replaceSessionInsertion = useCallback((session: DictationSession, next: string) => {
    const current = inputRef.current;
    if (
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
      const recorder = new MediaRecorder(session.stream, { mimeType: format.mimeType });
      session.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        if (session.closed) return;
        if (session.timer !== null) window.clearTimeout(session.timer);
        session.timer = null;
        if (session.recorder === recorder) session.recorder = null;
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
      recorder.start();
      session.timer = window.setTimeout(() => recorder.stop(), CHUNK_DURATION_MS);
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
    if (!current.enabled || !current.prepared || sessionRef.current || startingRef.current) return;
    startingRef.current = true;
    let stream: MediaStream | null = null;
    try {
      const status = await runtime.runPromise(fetchDictationStatus(current.prepared));
      if (
        !mountedRef.current ||
        !inputRef.current.enabled ||
        inputRef.current.prepared !== current.prepared
      ) {
        return;
      }
      if (!status.available) {
        current.reportError(
          status.reason === "groq_api_key_missing"
            ? "Add GROQ_API_KEY to the connected host to use voice dictation."
            : "Voice dictation is available only in internal builds.",
        );
        return;
      }
      if (typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support audio recording.");
      }
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (
        !mountedRef.current ||
        !inputRef.current.enabled ||
        inputRef.current.prepared !== current.prepared
      ) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      const snapshot = inputRef.current.readComposer();
      const session: DictationSession = {
        prepared: current.prepared,
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
      const session = sessionRef.current;
      if (session) {
        session.cancelled = true;
        closeSession(session);
      } else if (stream) {
        for (const track of stream.getTracks()) track.stop();
      }
      if (mountedRef.current) current.reportError(errorMessage(error));
      if (mountedRef.current) setPhase("idle");
    } finally {
      startingRef.current = false;
    }
  }, [closeSession]);

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (input.prepared !== session.prepared) {
      session.cancelled = true;
      closeSession(session);
      return;
    }
    if (input.enabled) return;
    if (phase === "recording") {
      stop();
      return;
    }
    session.cancelled = true;
    closeSession(session);
  }, [closeSession, input.enabled, input.prepared, phase, stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
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
    toggle: phase === "recording" ? stop : start,
  } as const;
}
