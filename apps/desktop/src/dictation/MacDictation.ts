// @effect-diagnostics nodeBuiltinImport:off -- This macOS platform boundary spawns the Speech.framework helper with Node.

import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

export const MAC_DICTATION_HELPER_NAME = "t3-dictation-helper";

export type MacDictationEvent =
  | { readonly type: "ready" }
  | { readonly type: "transcript"; readonly text: string }
  | { readonly type: "error"; readonly message: string }
  | { readonly type: "ended" };

export function resolveMacDictationHelperCandidates(input: {
  readonly platform: string;
  readonly isPackaged: boolean;
  readonly execDir: string;
  readonly rootDir: string;
  readonly processArch: string;
  readonly resourcesPath: string;
}): readonly string[] {
  if (input.platform !== "darwin") return [];
  const arch = input.processArch === "arm64" ? "arm64" : "x64";
  const resourceHelper = NodePath.join(
    input.resourcesPath,
    "mac-dictation",
    MAC_DICTATION_HELPER_NAME,
  );
  if (input.isPackaged) {
    return [NodePath.join(input.execDir, MAC_DICTATION_HELPER_NAME), resourceHelper];
  }
  return [
    NodePath.join(input.rootDir, "native/mac-dictation/build", arch, MAC_DICTATION_HELPER_NAME),
    resourceHelper,
  ];
}

export function parseMacDictationEvent(line: string): MacDictationEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const value: unknown = JSON.parse(trimmed);
    if (typeof value !== "object" || value === null || !("type" in value)) return null;
    const type = Reflect.get(value, "type");
    if (type === "ready" || type === "ended") return { type };
    if (type === "transcript") {
      const text = Reflect.get(value, "text");
      return typeof text === "string" ? { type, text } : null;
    }
    if (type === "error") {
      const message = Reflect.get(value, "message");
      return {
        type,
        message:
          typeof message === "string" && message.trim()
            ? message
            : "macOS speech recognition failed.",
      };
    }
    return null;
  } catch {
    return null;
  }
}

export type MacDictationSession = {
  readonly stop: () => Promise<void>;
  readonly cancel: () => Promise<void>;
};

export async function startMacDictation(input: {
  readonly helperPath: string;
  readonly locale: string;
  readonly onEvent: (event: MacDictationEvent) => void;
}): Promise<MacDictationSession> {
  const child = NodeChildProcess.spawn(input.helperPath, ["--locale", input.locale], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  let settled = false;
  let stopped = false;
  let stdout = "";
  let ready!: (session: MacDictationSession) => void;
  let fail!: (error: Error) => void;
  const started = new Promise<MacDictationSession>((resolve, reject) => {
    ready = resolve;
    fail = reject;
  });
  const readyTimeout = setTimeout(() => {
    finish(
      new Error(
        "macOS speech recognition did not start. Check microphone and Speech Recognition permissions.",
      ),
    );
  }, 30_000);

  const session: MacDictationSession = {
    stop: () => requestStop("stop"),
    cancel: () => requestStop("cancel"),
  };

  const finish = (error?: Error) => {
    if (stopped) return;
    stopped = true;
    child.stdin.end();
    child.kill();
    if (!settled) {
      settled = true;
      clearTimeout(readyTimeout);
      fail(error ?? new Error("macOS speech recognition failed."));
      return;
    }
    if (error) input.onEvent({ type: "error", message: error.message });
    input.onEvent({ type: "ended" });
  };

  function requestStop(command: "stop" | "cancel"): Promise<void> {
    if (stopped) return Promise.resolve();
    try {
      child.stdin.write(`${JSON.stringify({ cmd: command })}\n`);
    } catch {
      finish();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        finish();
        resolve();
      }, 2_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  const consume = (chunk: Buffer) => {
    stdout += chunk.toString("utf8");
    const lines = stdout.split("\n");
    stdout = lines.pop() ?? "";
    for (const line of lines) {
      const event = parseMacDictationEvent(line);
      if (!event) continue;
      if (event.type === "ready" && !settled) {
        settled = true;
        clearTimeout(readyTimeout);
        ready(session);
        continue;
      }
      if (event.type === "error" && !settled) {
        settled = true;
        stopped = true;
        clearTimeout(readyTimeout);
        child.kill();
        fail(new Error(event.message));
        continue;
      }
      input.onEvent(event);
      if (event.type === "ended") {
        stopped = true;
        child.kill();
      }
    }
  };

  child.stdout.on("data", consume);
  child.once("error", (error) => {
    finish(error);
  });
  child.once("exit", (code) => {
    if (stopped) return;
    if (code === 0 || code === null) {
      finish();
      return;
    }
    finish(new Error(`macOS speech recognition exited with code ${code}.`));
  });

  return started;
}
