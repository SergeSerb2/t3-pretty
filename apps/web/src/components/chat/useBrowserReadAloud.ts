import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { readAloudChunks, synthesizeReadAloud } from "@t3tools/client-runtime/state/read-aloud";
import { useCallback, useEffect, useRef, useState } from "react";

import { runtime } from "../../lib/runtime";

export type ReadAloudPhase = "idle" | "loading" | "playing";

interface ReadAloudSession {
  readonly messageId: string;
  readonly prepared: PreparedConnection;
  cancelled: boolean;
  audio: HTMLAudioElement | null;
  objectUrl: string | null;
  finishPlayback: (() => void) | null;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Read aloud failed. Please try again.";
}

function wavBlob(audioBase64: string): Blob {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return new Blob([bytes], { type: "audio/wav" });
}

export function useBrowserReadAloud(input: {
  readonly enabled: boolean;
  readonly prepared: PreparedConnection | null;
  readonly reportError: (message: string) => void;
}) {
  const [state, setState] = useState<{
    readonly activeMessageId: string | null;
    readonly phase: ReadAloudPhase;
  }>({ activeMessageId: null, phase: "idle" });
  const sessionRef = useRef<ReadAloudSession | null>(null);
  const mountedRef = useRef(true);
  const inputRef = useRef(input);
  inputRef.current = input;

  const releaseAudio = useCallback((session: ReadAloudSession, preservePlayer = false) => {
    session.finishPlayback?.();
    session.finishPlayback = null;
    if (session.audio) {
      session.audio.pause();
      session.audio.removeAttribute("src");
      session.audio.load();
      if (!preservePlayer) session.audio = null;
    }
    if (session.objectUrl) {
      URL.revokeObjectURL(session.objectUrl);
      session.objectUrl = null;
    }
  }, []);

  const closeSession = useCallback(
    (session: ReadAloudSession) => {
      releaseAudio(session);
      if (sessionRef.current !== session) return;
      sessionRef.current = null;
      if (mountedRef.current) setState({ activeMessageId: null, phase: "idle" });
    },
    [releaseAudio],
  );

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.cancelled = true;
    closeSession(session);
  }, [closeSession]);

  const playAudio = useCallback(async (session: ReadAloudSession, audioBase64: string) => {
    const objectUrl = URL.createObjectURL(wavBlob(audioBase64));
    const audio = session.audio ?? new Audio();
    audio.src = objectUrl;
    session.objectUrl = objectUrl;
    session.audio = audio;

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.removeEventListener("ended", finish);
        audio.removeEventListener("error", fail);
        session.finishPlayback = null;
      };
      const finish = () => {
        cleanup();
        resolve();
      };
      const fail = () => {
        cleanup();
        reject(new Error("The generated audio could not be played."));
      };
      session.finishPlayback = finish;
      audio.addEventListener("ended", finish);
      audio.addEventListener("error", fail);
      void audio.play().catch(fail);
    });
  }, []);

  const start = useCallback(
    async (messageId: string, markdown: string) => {
      const current = inputRef.current;
      if (!current.enabled) return;
      if (!current.prepared) {
        current.reportError("Reconnect to the environment to use read aloud.");
        return;
      }
      const chunks = readAloudChunks(markdown);
      if (chunks.length === 0) return;
      if (sessionRef.current?.messageId === messageId) {
        stop();
        return;
      }
      stop();

      const session: ReadAloudSession = {
        messageId,
        prepared: current.prepared,
        cancelled: false,
        audio: null,
        objectUrl: null,
        finishPlayback: null,
      };
      sessionRef.current = session;
      setState({ activeMessageId: messageId, phase: "loading" });

      try {
        for (const chunk of chunks) {
          const result = await runtime.runPromise(
            synthesizeReadAloud({ prepared: session.prepared, text: chunk }),
          );
          if (session.cancelled || sessionRef.current !== session) return;
          setState({ activeMessageId: messageId, phase: "playing" });
          await playAudio(session, result.audioBase64);
          releaseAudio(session, true);
          if (session.cancelled || sessionRef.current !== session) return;
        }
      } catch (error) {
        if (!session.cancelled) inputRef.current.reportError(errorMessage(error));
      } finally {
        closeSession(session);
      }
    },
    [closeSession, playAudio, releaseAudio, stop],
  );

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (!input.enabled || input.prepared !== session.prepared) stop();
  }, [input.enabled, input.prepared, stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop]);

  return { ...state, toggle: start, stop } as const;
}
