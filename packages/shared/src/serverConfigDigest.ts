import { ServerConfig } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const encodeServerConfig = Schema.encodeSync(ServerConfig);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

/**
 * Small deterministic identity for deciding whether a server-config stream
 * needs to repeat the full bootstrap snapshot. This is not a security hash;
 * two independent FNV-1a lanes make accidental collisions vanishingly rare.
 */
export function serverConfigDigest(config: typeof ServerConfig.Type): string {
  const json = JSON.stringify(canonicalize(encodeServerConfig(config)));
  let first = 0x811c9dc5;
  let second = 0x9e3779b9;
  for (let index = 0; index < json.length; index += 1) {
    const code = json.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ (code + index), 0x85ebca6b) >>> 0;
  }
  return `${json.length.toString(36)}-${first.toString(36)}-${second.toString(36)}`;
}
