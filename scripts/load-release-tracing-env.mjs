#!/usr/bin/env node

import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

const MAX_TRACING_ENV_BYTES = 64 * 1024;
const MAX_TRACING_VALUE_BYTES = {
  T3CODE_RELAY_CLIENT_OTLP_TRACES_URL: 4096,
  T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET: 1024,
  T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: 8192,
};
const TRACING_ENV_KEYS = [
  "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL",
  "T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET",
  "T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN",
];

function hasControlCharacter(value) {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f);
  });
}

export function parseReleaseTracingEnvironment(source) {
  if (Buffer.byteLength(source, "utf8") > MAX_TRACING_ENV_BYTES) {
    throw new Error(`Release tracing environment exceeds ${MAX_TRACING_ENV_BYTES} bytes.`);
  }

  const values = new Map();
  const lines = source.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  for (const line of lines) {
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error("Release tracing environment contains a malformed entry.");
    }
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1);
    if (hasControlCharacter(key) || !TRACING_ENV_KEYS.includes(key)) {
      throw new Error("Release tracing environment contains an unexpected key.");
    }
    if (values.has(key)) {
      throw new Error(`Release tracing environment contains a duplicate key: ${key}`);
    }
    if (!value || hasControlCharacter(value)) {
      throw new Error(`Release tracing environment contains an invalid value for ${key}.`);
    }
    if (Buffer.byteLength(value, "utf8") > MAX_TRACING_VALUE_BYTES[key]) {
      throw new Error(`Release tracing environment contains an oversized value for ${key}.`);
    }
    values.set(key, value);
  }

  for (const key of TRACING_ENV_KEYS) {
    if (!values.has(key)) {
      throw new Error(`Release tracing environment is missing required key: ${key}`);
    }
  }

  let tracingUrl;
  try {
    tracingUrl = new URL(values.get("T3CODE_RELAY_CLIENT_OTLP_TRACES_URL"));
  } catch {
    throw new Error("Release tracing URL must be a valid credential-free HTTPS URL.");
  }
  if (
    tracingUrl.protocol !== "https:" ||
    tracingUrl.username ||
    tracingUrl.password ||
    tracingUrl.search ||
    tracingUrl.hash
  ) {
    throw new Error("Release tracing URL must be HTTPS and must not contain credentials.");
  }
  values.set("T3CODE_RELAY_CLIENT_OTLP_TRACES_URL", tracingUrl.toString());

  return Object.fromEntries(TRACING_ENV_KEYS.map((key) => [key, values.get(key)]));
}

export function serializeReleaseTracingEnvironment(values) {
  return TRACING_ENV_KEYS.map((key) => `${key}=${values[key]}\n`).join("");
}

export function escapeGitHubWorkflowCommand(value) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

export function readBoundedReleaseTracingEnvironment(filePath) {
  const file = NodeFS.openSync(
    filePath,
    NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const metadata = NodeFS.fstatSync(file);
    if (!metadata.isFile() || metadata.size > MAX_TRACING_ENV_BYTES) {
      throw new Error("Release tracing environment is not a bounded regular file.");
    }
    const bytes = Buffer.alloc(MAX_TRACING_ENV_BYTES + 1);
    let length = 0;
    while (length < bytes.byteLength) {
      const read = NodeFS.readSync(file, bytes, length, bytes.byteLength - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > MAX_TRACING_ENV_BYTES) {
      throw new Error(`Release tracing environment exceeds ${MAX_TRACING_ENV_BYTES} bytes.`);
    }
    return parseReleaseTracingEnvironment(bytes.subarray(0, length).toString("utf8"));
  } finally {
    NodeFS.closeSync(file);
  }
}

export function main(argv = process.argv.slice(2)) {
  const [inputPath, githubEnvPath] = argv;
  if (!inputPath || !githubEnvPath) {
    throw new Error("Usage: load-release-tracing-env <input-path> <github-env-path>");
  }
  const values = readBoundedReleaseTracingEnvironment(inputPath);
  const token = values.T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN;
  process.stdout.write(`::add-mask::${escapeGitHubWorkflowCommand(token)}\n`);
  NodeFS.appendFileSync(githubEnvPath, serializeReleaseTracingEnvironment(values));
}

const invokedPath = process.argv[1] ? NodePath.resolve(process.argv[1]) : "";
if (invokedPath === NodeURL.fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
