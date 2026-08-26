import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import { readAloudChunks, synthesizeReadAloud } from "@t3tools/client-runtime/state/read-aloud";
import { File, Paths } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";

import { runtime } from "../../lib/runtime";

export type ReadAloudPhase = "idle" | "loading" | "playing";
type ExpoAudio = typeof import("expo-audio");
type ExpoAudioPlayer = ReturnType<ExpoAudio["createAudioPlayer"]>;

interface ReadAloudSession {
  readonly messageId: string;
  readonly prepared: PreparedConnection;
  cancelled: boolean;
  synthesisAbort: AbortController | null;
  player: ExpoAudioPlayer | null;
  subscription: { remove(): void } | null;
  file: File | null;
  finishPlayback: (() => void) | null;
}

let audioFileSequence = 0;
const AUDIO_LOAD_TIMEOUT_MS = 10_000;

function errorMessage(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = Reflect.get(error, "message");
    if (typeof message === "string" && message.trim()) return message;
  }
  return "Read aloud failed. Please try again.";
}

export function useNativeReadAloud(input: {
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

  const releaseAudio = useCallback((session: ReadAloudSession) => {
    session.finishPlayback?.();
    session.finishPlayback = null;
    session.subscription?.remove();
    session.subscription = null;
    if (session.player) {
      session.player.pause();
      session.player.remove();
      session.player = null;
    }
    if (session.file) {
      try {
        session.file.delete();
      } catch {
        // Cache cleanup is best effort; the platform also reclaims these files.
      }
      session.file = null;
    }
  }, []);

  const closeSession = useCallback(
    (session: ReadAloudSession) => {
      session.synthesisAbort?.abort();
      session.synthesisAbort = null;
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

  const playAudio = useCallback(
    async (session: ReadAloudSession, audio: ExpoAudio, audioBase64: string) => {
      const file = new File(Paths.cache, `t3-read-aloud-${Date.now()}-${audioFileSequence++}.wav`);
      file.write(audioBase64, { encoding: "base64" });
      if (session.cancelled || sessionRef.current !== session) {
        file.delete();
        return;
      }
      const player = audio.createAudioPlayer(file.uri);
      session.file = file;
      session.player = player;

      await new Promise<void>((resolve, reject) => {
        let started = false;
        let settled = false;
        let loadTimeout: ReturnType<typeof setTimeout> | null = null;
        const cleanup = () => {
          if (loadTimeout) clearTimeout(loadTimeout);
          loadTimeout = null;
          session.subscription?.remove();
          session.subscription = null;
          session.finishPlayback = null;
        };
        const finish = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };
        const handleStatus = (status: ExpoAudioPlayer["currentStatus"]) => {
          if (status.error) {
            fail(new Error(status.error));
          } else if (!started && status.isLoaded && status.duration > 0) {
            started = true;
            if (loadTimeout) clearTimeout(loadTimeout);
            loadTimeout = null;
            try {
              player.play();
            } catch (error) {
              fail(error instanceof Error ? error : new Error("Audio playback failed."));
            }
          } else if (started && status.didJustFinish) {
            finish();
          }
        };
        session.finishPlayback = finish;
        loadTimeout = setTimeout(
          () => fail(new Error("The generated audio did not become playable.")),
          AUDIO_LOAD_TIMEOUT_MS,
        );
        session.subscription = player.addListener("playbackStatusUpdate", handleStatus);
        handleStatus(player.currentStatus);
      });
    },
    [],
  );

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

      const session: ReadAloudSession = {
        messageId,
        prepared: current.prepared,
        cancelled: false,
        synthesisAbort: null,
        player: null,
        subscription: null,
        file: null,
        finishPlayback: null,
      };
      sessionRef.current = session;
      setState({ activeMessageId: messageId, phase: "loading" });

      try {
        const audio = await import("expo-audio");
        await audio.setAudioModeAsync({ playsInSilentMode: true });
        for (const chunk of chunks) {
          if (session.cancelled || sessionRef.current !== session) return;
          setState({ activeMessageId: messageId, phase: "loading" });
          const synthesisAbort = new AbortController();
          session.synthesisAbort = synthesisAbort;
          const result = await runtime.runPromise(
            synthesizeReadAloud({ prepared: session.prepared, text: chunk }),
            { signal: synthesisAbort.signal },
          );
          if (session.synthesisAbort === synthesisAbort) session.synthesisAbort = null;
          if (session.cancelled || sessionRef.current !== session) return;
          setState({ activeMessageId: messageId, phase: "playing" });
          await playAudio(session, audio, result.audioBase64);
          releaseAudio(session);
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
