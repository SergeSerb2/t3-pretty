import type { DesktopBridge } from "@t3tools/contracts";

export type LocalDictationEngine = "mac-desktop" | "web-speech";

export type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

export type SpeechRecognitionResultEventLike = {
  readonly results: ArrayLike<{
    readonly isFinal?: boolean;
    readonly length: number;
    readonly [index: number]: { readonly transcript?: string };
  }>;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

type DictationWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  desktopBridge?: DesktopBridge;
};

export function getSpeechRecognitionConstructor(
  targetWindow: DictationWindow | undefined = typeof window === "undefined" ? undefined : window,
): SpeechRecognitionConstructor | null {
  if (targetWindow === undefined) return null;
  return targetWindow.SpeechRecognition ?? targetWindow.webkitSpeechRecognition ?? null;
}

export function resolveLocalDictationEngine(input: {
  readonly desktopBridge?: Pick<DesktopBridge, "startDictation" | "getClientPlatform">;
  readonly speechRecognitionAvailable: boolean;
}): LocalDictationEngine | null {
  if (input.desktopBridge !== undefined) {
    return typeof input.desktopBridge.startDictation === "function" &&
      input.desktopBridge.getClientPlatform?.() === "darwin"
      ? "mac-desktop"
      : null;
  }
  return input.speechRecognitionAvailable ? "web-speech" : null;
}

export function resolveLocalDictationEngineFromWindow(
  targetWindow: DictationWindow | undefined = typeof window === "undefined" ? undefined : window,
): LocalDictationEngine | null {
  if (targetWindow === undefined) return null;
  return resolveLocalDictationEngine({
    ...(targetWindow.desktopBridge === undefined
      ? {}
      : { desktopBridge: targetWindow.desktopBridge }),
    speechRecognitionAvailable: getSpeechRecognitionConstructor(targetWindow) !== null,
  });
}

export function isLocalDictationSupported(
  targetWindow: DictationWindow | undefined = typeof window === "undefined" ? undefined : window,
): boolean {
  return resolveLocalDictationEngineFromWindow(targetWindow) !== null;
}

export function localDictationHint(engine: LocalDictationEngine | null): string | null {
  switch (engine) {
    case "mac-desktop":
      return "macOS speech recognition";
    case "web-speech":
      return "This browser's speech recognition";
    case null:
      return null;
  }
}

export function transcriptFromSpeechRecognitionEvent(
  event: SpeechRecognitionResultEventLike,
): string {
  let transcript = "";
  for (let index = 0; index < event.results.length; index += 1) {
    const alternative = event.results[index]?.[0]?.transcript;
    if (typeof alternative === "string") transcript += alternative;
  }
  return transcript;
}
