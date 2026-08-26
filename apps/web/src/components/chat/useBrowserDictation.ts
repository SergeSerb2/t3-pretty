import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import {
  appendDictationSegment,
  cleanupDictation,
  fetchDictationStatus,
  formatDictationInsertion,
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
  const mountedRef = useRef(true);
  const inputRef = useRef(input);
  inputRef.current = input;

  const closeSession = useCallback((session: DictationSession) => {
    if (session.timer !== null) window.clearTimeout(session.timer);
    for (const track of session.stream.getTracks()) track.stop();
    if (sessionRef.current === session) sessionRef.current = null;
    if (mountedRef.current) setPhase("idle");
  }, []);

  const finishSession = useCallback(
    async (session: DictationSession) => {
      if (session.finalizing) return;
      session.finalizing = true;
      if (mountedRef.current) setPhase("processing");
      await session.queue;
      if (session.cancelled) {
        closeSession(session);
        return;
      }
      if (session.error) {
        inputRef.current.reportError(errorMessage(session.error));
        closeSession(session);
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
          const insertion = formatDictationInsertion({
            before: session.before,
            after: session.after,
            transcript: result.text,
          });
          if (!inputRef.current.replaceInsertion(session.start, session.insertion, insertion)) {
            inputRef.current.reportError("The composer changed; the raw transcript was kept.");
          }
        } catch {
          inputRef.current.reportError("Voice cleanup failed; the raw transcript was kept.");
        }
      }
      closeSession(session);
    },
    [closeSession],
  );

  const transcribeChunk = useCallback(
    async (session: DictationSession, blob: Blob, apiMimeType: DictationAudioMimeType) => {
      const audioBase64 = await blobBase64(blob);
      const result = await runtime.runPromise(
        transcribeDictationAudio({
          prepared: session.prepared,
          audioBase64,
          mimeType: apiMimeType,
        }),
      );
      if (session.cancelled) return;
      session.transcript = appendDictationSegment(session.transcript, result.text);
      const insertion = formatDictationInsertion({
        before: session.before,
        after: session.after,
        transcript: session.transcript,
      });
      if (!inputRef.current.replaceInsertion(session.start, session.insertion, insertion)) {
        throw new Error("The composer changed while dictation was running.");
      }
      session.insertion = insertion;
    },
    [],
  );

  const beginChunkRef = useRef<(session: DictationSession) => void>(() => {});
  beginChunkRef.current = (session) => {
    if (session.stopRequested || session.cancelled) {
      void finishSession(session);
      return;
    }
    const format = recordingFormat();
    const chunks: Blob[] = [];
    const recorder = new MediaRecorder(session.stream, { mimeType: format.mimeType });
    session.recorder = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      if (session.timer !== null) window.clearTimeout(session.timer);
      session.timer = null;
      const blob = new Blob(chunks, { type: format.mimeType });
      if (blob.size > 0 && !session.error) {
        session.queue = session.queue.then(async () => {
          if (session.error || session.cancelled) return;
          try {
            await transcribeChunk(session, blob, format.apiMimeType);
          } catch (error) {
            session.error = error;
            session.stopRequested = true;
            if (session.recorder?.state === "recording") session.recorder.stop();
          }
        });
      }
      if (session.stopRequested || session.error) {
        void finishSession(session);
      } else {
        beginChunkRef.current(session);
      }
    };
    recorder.start();
    session.timer = window.setTimeout(() => recorder.stop(), CHUNK_DURATION_MS);
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
      if (typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support audio recording.");
      }
      const snapshot = current.readComposer();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      };
      sessionRef.current = session;
      setPhase("recording");
      beginChunkRef.current(session);
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
