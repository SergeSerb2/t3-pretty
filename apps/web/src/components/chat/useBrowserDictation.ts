import {
  formatDictationInsertion,
  replaceDictationInsertion,
} from "@t3tools/client-runtime/state/dictation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  getSpeechRecognitionConstructor,
  localDictationHint,
  resolveLocalDictationEngineFromWindow,
  transcriptFromSpeechRecognitionEvent,
  type LocalDictationEngine,
  type SpeechRecognitionLike,
} from "../../lib/localDictation";

const RECORDING_LIMIT_MS = 5 * 60_000;

export type DictationPhase = "idle" | "preparing" | "recording" | "processing";

interface DictationSession {
  readonly ownerKey: string;
  readonly engine: LocalDictationEngine;
  readonly start: number;
  readonly before: string;
  readonly after: string;
  insertion: string;
  recognition: SpeechRecognitionLike | null;
  unsubscribe: (() => void) | null;
  timer: number | null;
  stopRequested: boolean;
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

function speechRecognitionErrorMessage(code: string | undefined): string | null {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access was denied. Allow T3 Pretty to use your microphone in system or browser settings.";
    case "audio-capture":
      return "No microphone is available.";
    case "language-not-supported":
      return "Speech recognition does not support this language.";
    case "no-speech":
    case "aborted":
      return null;
    default:
      return "Voice dictation failed. Please try again.";
  }
}

function dictationLocale(): string {
  return (
    window.desktopBridge?.getSystemLocale?.()?.trim() ||
    Intl.DateTimeFormat().resolvedOptions().locale ||
    "en-US"
  );
}

export function useBrowserDictation(input: {
  readonly ownerKey: string;
  readonly enabled: boolean;
  /** When false, refuse to begin a new capture. Does not cancel an in-flight session. */
  readonly canStart?: boolean;
  readonly readComposer: () => { readonly value: string; readonly cursor: number };
  readonly replaceInsertion: (start: number, previous: string, next: string) => boolean;
  readonly reportError: (message: string) => void;
}) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const sessionRef = useRef<DictationSession | null>(null);
  const startingRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const inputRef = useRef(input);
  inputRef.current = input;
  const engine = resolveLocalDictationEngineFromWindow();

  const closeSession = useCallback((session: DictationSession) => {
    if (session.closed) return;
    session.closed = true;
    if (session.timer !== null) window.clearTimeout(session.timer);
    session.timer = null;
    session.unsubscribe?.();
    session.unsubscribe = null;
    const recognition = session.recognition;
    session.recognition = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // The browser Speech API can throw if it already stopped.
      }
    }
    if (sessionRef.current === session) sessionRef.current = null;
    if (mountedRef.current) setPhase("idle");
  }, []);

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

  const applyTranscript = useCallback(
    (session: DictationSession, transcript: string) => {
      if (session.cancelled || session.closed) return false;
      const insertion = formatDictationInsertion({
        before: session.before,
        after: session.after,
        transcript,
      });
      if (!replaceSessionInsertion(session, insertion)) {
        session.error = new Error("The composer changed while dictation was running.");
        return false;
      }
      session.insertion = insertion;
      return true;
    },
    [replaceSessionInsertion],
  );

  const finishSession = useCallback(
    (session: DictationSession) => {
      if (session.closed) return;
      if (session.error && !session.cancelled) {
        inputRef.current.reportError(errorMessage(session.error));
      }
      closeSession(session);
    },
    [closeSession],
  );

  const requestEngineStop = useCallback(
    async (session: DictationSession, command: "stop" | "cancel") => {
      if (session.engine === "mac-desktop") {
        const bridge = window.desktopBridge;
        try {
          if (command === "cancel") await bridge?.cancelDictation?.();
          else await bridge?.stopDictation?.();
        } catch {
          // The helper may already have exited.
        }
        return;
      }
      const recognition = session.recognition;
      if (!recognition) return;
      try {
        if (command === "cancel") recognition.abort();
        else recognition.stop();
      } catch {
        // The browser Speech API can throw if it already stopped.
      }
    },
    [],
  );

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.stopRequested || session.closed) return;
    session.stopRequested = true;
    if (mountedRef.current) setPhase("processing");
    void requestEngineStop(session, "stop").then(() => {
      if (session.engine === "web-speech") return;
      if (!session.closed) finishSession(session);
    });
  }, [finishSession, requestEngineStop]);

  const cancel = useCallback(() => {
    startingRef.current?.abort();
    startingRef.current = null;
    const session = sessionRef.current;
    if (session) {
      session.cancelled = true;
      session.stopRequested = true;
      replaceSessionInsertion(session, "");
      void requestEngineStop(session, "cancel");
      closeSession(session);
    }
    if (mountedRef.current) setPhase("idle");
  }, [closeSession, replaceSessionInsertion, requestEngineStop]);

  const start = useCallback(async () => {
    const current = inputRef.current;
    if (
      !current.enabled ||
      current.canStart === false ||
      sessionRef.current ||
      startingRef.current
    ) {
      return;
    }
    const nextEngine = resolveLocalDictationEngineFromWindow();
    if (nextEngine === null) {
      current.reportError(
        "Voice dictation is not available here. Use T3 Pretty on macOS or a browser with speech recognition.",
      );
      return;
    }
    const abort = new AbortController();
    startingRef.current = abort;
    setPhase("preparing");
    const snapshot = current.readComposer();
    const startStillValid = () =>
      !abort.signal.aborted &&
      mountedRef.current &&
      inputRef.current.enabled &&
      inputRef.current.canStart !== false &&
      inputRef.current.ownerKey === current.ownerKey;

    const session: DictationSession = {
      ownerKey: current.ownerKey,
      engine: nextEngine,
      start: snapshot.cursor,
      before: snapshot.value.slice(0, snapshot.cursor),
      after: snapshot.value.slice(snapshot.cursor),
      insertion: "",
      recognition: null,
      unsubscribe: null,
      timer: null,
      stopRequested: false,
      error: null,
      cancelled: false,
      closed: false,
    };

    try {
      if (nextEngine === "mac-desktop") {
        const bridge = window.desktopBridge;
        if (
          typeof bridge?.startDictation !== "function" ||
          typeof bridge.stopDictation !== "function" ||
          typeof bridge.cancelDictation !== "function" ||
          typeof bridge.onDictationEvent !== "function"
        ) {
          throw new Error("macOS speech recognition is not available in this desktop build.");
        }
        session.unsubscribe = bridge.onDictationEvent((event) => {
          if (session.cancelled || session.closed) return;
          if (event.type === "transcript") {
            if (!applyTranscript(session, event.text) && !session.stopRequested) {
              session.stopRequested = true;
              void requestEngineStop(session, "stop").then(() => finishSession(session));
            }
            return;
          }
          if (event.type === "error") {
            session.error = new Error(event.message);
            session.stopRequested = true;
            finishSession(session);
            return;
          }
          if (event.type === "ended") {
            finishSession(session);
          }
        });
        sessionRef.current = session;
        await bridge.startDictation({ locale: dictationLocale() });
        if (!startStillValid()) {
          session.cancelled = true;
          await bridge.cancelDictation();
          closeSession(session);
          return;
        }
        const next = inputRef.current.readComposer();
        if (next.value !== snapshot.value || next.cursor !== snapshot.cursor) {
          session.cancelled = true;
          await bridge.cancelDictation();
          closeSession(session);
          throw new Error("The composer changed before recording started. Please try again.");
        }
      } else {
        const Recognition = getSpeechRecognitionConstructor();
        if (Recognition === null) {
          throw new Error("This browser does not support speech recognition.");
        }
        const recognition = new Recognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = dictationLocale();
        recognition.onresult = (event) => {
          if (session.cancelled || session.closed) return;
          if (!applyTranscript(session, transcriptFromSpeechRecognitionEvent(event))) {
            session.stopRequested = true;
            try {
              recognition.stop();
            } catch {
              finishSession(session);
            }
          }
        };
        recognition.onerror = (event) => {
          if (session.cancelled || session.closed) return;
          const message = speechRecognitionErrorMessage(event.error);
          if (message === null) return;
          session.error = new Error(message);
          session.stopRequested = true;
        };
        recognition.onend = () => {
          if (session.closed || session.cancelled) return;
          if (session.stopRequested || session.error) {
            finishSession(session);
            return;
          }
          try {
            recognition.start();
          } catch (error) {
            session.error = error;
            finishSession(session);
          }
        };
        session.recognition = recognition;
        sessionRef.current = session;
        recognition.start();
        if (!startStillValid()) {
          session.cancelled = true;
          closeSession(session);
          return;
        }
        const next = inputRef.current.readComposer();
        if (next.value !== snapshot.value || next.cursor !== snapshot.cursor) {
          session.cancelled = true;
          closeSession(session);
          throw new Error("The composer changed before recording started. Please try again.");
        }
      }

      if (session.closed || session.cancelled) return;
      session.timer = window.setTimeout(() => {
        if (sessionRef.current === session) stop();
      }, RECORDING_LIMIT_MS);
      setPhase("recording");
    } catch (error) {
      if (abort.signal.aborted) {
        session.cancelled = true;
        void requestEngineStop(session, "cancel");
        closeSession(session);
        return;
      }
      session.cancelled = true;
      void requestEngineStop(session, "cancel");
      closeSession(session);
      if (mountedRef.current) current.reportError(errorMessage(error));
      if (mountedRef.current) setPhase("idle");
    } finally {
      if (startingRef.current === abort) {
        startingRef.current = null;
        if (!sessionRef.current && mountedRef.current) setPhase("idle");
      }
    }
  }, [applyTranscript, closeSession, finishSession, requestEngineStop, stop]);

  const toggle = useCallback(() => {
    if (startingRef.current) return cancel();
    if (sessionRef.current) return stop();
    return start();
  }, [cancel, start, stop]);

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
      session.stopRequested = true;
      void requestEngineStop(session, "cancel");
      closeSession(session);
    }
    setPhase("idle");
  }, [closeSession, input.ownerKey, requestEngineStop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      startingRef.current?.abort();
      const session = sessionRef.current;
      if (!session) return;
      session.cancelled = true;
      session.stopRequested = true;
      void requestEngineStop(session, "cancel");
      closeSession(session);
    };
  }, [closeSession, requestEngineStop]);

  return {
    phase,
    active: phase !== "idle",
    engine,
    hint: localDictationHint(engine),
    cancel,
    toggle,
  } as const;
}
