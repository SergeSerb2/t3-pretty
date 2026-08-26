import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { readAloudChunks, synthesizeReadAloud } from "@t3tools/client-runtime/state/read-aloud";
import { useCallback, useEffect, useRef, useState } from "react";

import { runtime } from "../../lib/runtime";

export type ReadAloudPhase = "idle" | "loading" | "playing";

interface ReadAloudSession {
  readonly messageId: string;
  readonly prepared: PreparedConnection;
  readonly audioContext: AudioContext;
  cancelled: boolean;
  synthesisAbort: AbortController | null;
  source: AudioBufferSourceNode | null;
  finishPlayback: (() => void) | null;
}

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Read aloud failed. Please try again.";
}

function wavBuffer(audioBase64: string): ArrayBuffer {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
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

  const releaseSource = useCallback((session: ReadAloudSession) => {
    session.finishPlayback?.();
    session.finishPlayback = null;
    if (session.source) {
      try {
        session.source.stop();
      } catch {
        // An ended source is already stopped.
      }
      session.source.disconnect();
      session.source = null;
    }
  }, []);

  const closeSession = useCallback(
    (session: ReadAloudSession) => {
      session.synthesisAbort?.abort();
      session.synthesisAbort = null;
      releaseSource(session);
      void session.audioContext.close().catch(() => undefined);
      if (sessionRef.current !== session) return;
      sessionRef.current = null;
      if (mountedRef.current) setState({ activeMessageId: null, phase: "idle" });
    },
    [releaseSource],
  );

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    session.cancelled = true;
    closeSession(session);
  }, [closeSession]);

  const playAudio = useCallback(async (session: ReadAloudSession, audioBase64: string) => {
    const buffer = await session.audioContext.decodeAudioData(wavBuffer(audioBase64));
    if (session.cancelled) return;
    if (session.audioContext.state !== "running") await session.audioContext.resume();
    if (session.cancelled) return;
    const source = session.audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(session.audioContext.destination);
    session.source = source;

    await new Promise<void>((resolve) => {
      const finish = () => {
        source.removeEventListener("ended", finish);
        session.finishPlayback = null;
        resolve();
      };
      session.finishPlayback = finish;
      source.addEventListener("ended", finish, { once: true });
      source.start();
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
      if (chunks.length === 0) {
        current.reportError("This response has no readable text.");
        return;
      }
      if (sessionRef.current?.messageId === messageId) {
        stop();
        return;
      }
      stop();

      let audioContext: AudioContext;
      try {
        audioContext = new AudioContext();
      } catch (error) {
        current.reportError(errorMessage(error));
        return;
      }
      const audioReady = audioContext.resume();
      const session: ReadAloudSession = {
        messageId,
        prepared: current.prepared,
        audioContext,
        cancelled: false,
        synthesisAbort: null,
        source: null,
        finishPlayback: null,
      };
      sessionRef.current = session;
      setState({ activeMessageId: messageId, phase: "loading" });

      try {
        await audioReady;
        let hasPlayedAudio = false;
        for (const chunk of chunks) {
          if (session.cancelled || sessionRef.current !== session) return;
          if (!hasPlayedAudio) setState({ activeMessageId: messageId, phase: "loading" });
          const synthesisAbort = new AbortController();
          session.synthesisAbort = synthesisAbort;
          const result = await runtime.runPromise(
            synthesizeReadAloud({ prepared: session.prepared, text: chunk }),
            { signal: synthesisAbort.signal },
          );
          if (session.synthesisAbort === synthesisAbort) session.synthesisAbort = null;
          if (session.cancelled || sessionRef.current !== session) return;
          setState({ activeMessageId: messageId, phase: "playing" });
          await playAudio(session, result.audioBase64);
          releaseSource(session);
          if (session.cancelled || sessionRef.current !== session) return;
          hasPlayedAudio = true;
        }
      } catch (error) {
        if (!session.cancelled) inputRef.current.reportError(errorMessage(error));
      } finally {
        closeSession(session);
      }
    },
    [closeSession, playAudio, releaseSource, stop],
  );

  useEffect(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (
      !input.enabled ||
      !input.prepared ||
      input.prepared.environmentId !== session.prepared.environmentId ||
      input.prepared.httpBaseUrl !== session.prepared.httpBaseUrl
    ) {
      stop();
    }
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
