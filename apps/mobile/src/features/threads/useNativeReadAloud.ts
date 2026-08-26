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
  player: ExpoAudioPlayer | null;
  subscription: { remove(): void } | null;
  file: File | null;
  finishPlayback: (() => void) | null;
}

let audioFileSequence = 0;

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
      const player = audio.createAudioPlayer(file.uri);
      session.file = file;
      session.player = player;

      await new Promise<void>((resolve, reject) => {
        const finish = () => {
          session.finishPlayback = null;
          resolve();
        };
        session.finishPlayback = finish;
        session.subscription = player.addListener("playbackStatusUpdate", (status) => {
          if (status.error) {
            session.finishPlayback = null;
            reject(new Error(status.error));
          } else if (status.didJustFinish) {
            finish();
          }
        });
        player.play();
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
          const result = await runtime.runPromise(
            synthesizeReadAloud({ prepared: session.prepared, text: chunk }),
          );
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
