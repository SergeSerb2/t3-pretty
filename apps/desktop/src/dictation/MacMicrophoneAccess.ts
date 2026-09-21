export type MacMicrophoneConsent = "granted" | "denied" | "restricted";

/**
 * macOS only presents the microphone dialog when the app that owns the TCC
 * client asks. A denied or restricted status will not show the dialog again.
 */
export async function ensureMacMicrophoneAccess(input: {
  readonly getStatus: () => string;
  readonly ask: () => Promise<boolean>;
}): Promise<MacMicrophoneConsent> {
  switch (input.getStatus()) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    case "restricted":
      return "restricted";
    default:
      return (await input.ask()) ? "granted" : "denied";
  }
}
