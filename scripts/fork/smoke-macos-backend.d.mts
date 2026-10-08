export const DEFAULT_TIMEOUT_MS: number;
export const OUTPUT_TAIL_BYTES: number;
export const MAX_FAILURE_LINE_BYTES: number;

export function advertisedListenNeedle(port: number): string;
export function retainUsefulChildOutput(current: string, chunk: string, limit?: number): string;
export function exitedBeforeReadinessMessage(
  code: number | null,
  signal: string | null,
  output: string,
): string;
export function readyTimeoutMessage(timeoutMs: number): string;
export function isInvokedAsCli(argv1?: string, moduleUrl?: string): boolean;

export interface SmokeMacosBackendAppInput {
  readonly appPath: string;
  readonly timeoutMs?: number;
}

export interface SmokeMacosBackendEntryInput {
  readonly executablePath: string;
  readonly entryPath: string;
  readonly electronAsNode?: boolean;
  readonly timeoutMs?: number;
}

export type SmokeMacosBackendInput = SmokeMacosBackendAppInput | SmokeMacosBackendEntryInput;

export function smokeMacosBackend(input: SmokeMacosBackendInput): Promise<void>;
