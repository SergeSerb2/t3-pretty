import type { PreparedConnection } from "@t3tools/client-runtime/connection";
import {
  cleanupDictation,
  fetchDictationStatus,
  transcribeDictationAudio,
} from "@t3tools/client-runtime/state/dictation";
import {
  VoiceTranscriptionError,
  throwIfVoiceTranscriptionAborted,
  type VoiceTranscriber,
} from "@t3tools/client-runtime/voice-input";
import {
  DICTATION_AUDIO_BASE64_MAX_LENGTH,
  DICTATION_CONTEXT_MAX_LENGTH,
} from "@t3tools/contracts";
import { File } from "expo-file-system";

import { runtime } from "../lib/runtime";

/** Bind the host and surrounding draft once; a later host change cannot redirect the recording. */
export function createGroqVoiceTranscriber(input: {
  readonly prepared: PreparedConnection;
  readonly before: string;
  readonly after: string;
}): VoiceTranscriber {
  return {
    prepare: async ({ signal }) => {
      throwIfVoiceTranscriptionAborted(signal);
      const status = await runtime.runPromise(fetchDictationStatus(input.prepared), { signal });
      throwIfVoiceTranscriptionAborted(signal);
      if (!status.available) {
        throw new VoiceTranscriptionError("unavailable", "The dictation host is unavailable.");
      }
      return {
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
        transcribe: async (uri, { signal }) => {
          throwIfVoiceTranscriptionAborted(signal);
          const file = new File(uri);
          // Expo often reports size 0 until contents are read; treat a known
          // oversized size as a fast path and always re-check the encoded payload.
          if (file.size > (DICTATION_AUDIO_BASE64_MAX_LENGTH / 4) * 3) {
            throw new VoiceTranscriptionError(
              "transcription-failed",
              "The recording is too large.",
            );
          }
          const audioBase64 = await file.base64();
          throwIfVoiceTranscriptionAborted(signal);
          if (!audioBase64) return "";
          if (audioBase64.length > DICTATION_AUDIO_BASE64_MAX_LENGTH) {
            throw new VoiceTranscriptionError(
              "transcription-failed",
              "The recording is too large.",
            );
          }
          const transcript = await runtime.runPromise(
            transcribeDictationAudio({
              prepared: input.prepared,
              audioBase64,
              mimeType: "audio/m4a",
            }),
            { signal },
          );
          throwIfVoiceTranscriptionAborted(signal);
          if (!transcript.text.trim()) return "";
          try {
            const result = await runtime.runPromise(
              cleanupDictation({
                prepared: input.prepared,
                transcript: transcript.text,
                before: input.before.slice(-DICTATION_CONTEXT_MAX_LENGTH),
                after: input.after.slice(0, DICTATION_CONTEXT_MAX_LENGTH),
              }),
              { signal },
            );
            throwIfVoiceTranscriptionAborted(signal);
            return result.text;
          } catch {
            throwIfVoiceTranscriptionAborted(signal);
            // A cleanup outage must not discard successfully transcribed speech.
            return transcript.text;
          }
        },
      };
    },
  };
}
