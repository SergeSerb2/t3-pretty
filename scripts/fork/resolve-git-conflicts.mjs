#!/usr/bin/env node

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

const API_URL = (
  process.env.CLI_PROXY_API_URL ?? "https://cli-proxy-api-production-1615.up.railway.app/v1"
).replace(/\/$/u, "");
const MODEL = process.env.CLI_PROXY_MODEL ?? "gpt-5.6-luna";
const SERVICE_TIER = process.env.CLI_PROXY_SERVICE_TIER ?? "priority";
const MAX_CONFLICTS = 12;
const MAX_FILE_BYTES = 160_000;

function git(args, options = {}) {
  return NodeChildProcess.execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  });
}

function readStage(stage, path) {
  try {
    return git(["show", `:${stage}:${path}`]);
  } catch {
    return null;
  }
}

function extractResponseText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  throw new Error("CLIProxyAPI response did not contain output text");
}

async function resolveConflict(path, token) {
  const base = readStage(1, path);
  const fork = readStage(2, path);
  const upstream = readStage(3, path);
  const sizes = [base, fork, upstream]
    .filter((value) => value !== null)
    .map((value) => Buffer.byteLength(value));
  if (sizes.some((size) => size > MAX_FILE_BYTES)) {
    throw new Error(`${path} exceeds the ${MAX_FILE_BYTES}-byte resolver limit`);
  }
  if ([base, fork, upstream].some((value) => value?.includes("\0"))) {
    throw new Error(`${path} is binary and cannot be AI-resolved`);
  }

  const prompt = `You are resolving one git merge conflict in a long-lived personal fork of T3 Code.

Merge contract:
- OURS is the personal fork main branch and is authoritative for fork-specific behavior.
- THEIRS is the newest upstream nightly and should be incorporated completely where compatible.
- Preserve every fork customization, including theme, sidebar/preview animations, terminal lifecycle behavior, providers, Windows SSH behavior, update/release infrastructure, and future fork-only changes.
- Also preserve upstream bug fixes, refactors, API changes, tests, and new behavior.
- Produce the smallest coherent merge. Do not invent unrelated functionality.
- If both intents cannot be preserved with high confidence, return safe=false. Never guess.
- Return the complete final file, or action=delete only when the correct merged result is deletion.

Path: ${path}

BASE (common ancestor; null means absent):
${JSON.stringify(base)}

OURS (personal fork; null means deleted):
${JSON.stringify(fork)}

THEIRS (upstream nightly; null means deleted):
${JSON.stringify(upstream)}`;

  const response = await fetch(`${API_URL}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      reasoning: { effort: "max" },
      service_tier: SERVICE_TIER,
      input: prompt,
      text: {
        format: {
          type: "json_schema",
          name: "git_conflict_resolution",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["safe", "action", "resolved_content", "summary"],
            properties: {
              safe: { type: "boolean" },
              action: { type: "string", enum: ["write", "delete"] },
              resolved_content: { type: "string" },
              summary: { type: "string" },
            },
          },
        },
      },
    }),
  });

  const raw = await response.text();
  if (!response.ok) {
    throw new Error(`CLIProxyAPI returned HTTP ${response.status}: ${raw.slice(0, 500)}`);
  }
  const apiResponse = JSON.parse(raw);
  if (apiResponse.status !== "completed") {
    throw new Error(`CLIProxyAPI response status was ${apiResponse.status ?? "missing"}`);
  }
  const resolution = JSON.parse(extractResponseText(apiResponse));
  if (resolution.safe !== true) {
    throw new Error(`${path} was not safe to resolve automatically: ${resolution.summary}`);
  }

  if (resolution.action === "delete") {
    if (NodeFS.existsSync(path)) NodeFS.rmSync(path);
    git(["add", "-A", "--", path]);
  } else {
    if (typeof resolution.resolved_content !== "string") {
      throw new Error(`${path} did not include resolved_content`);
    }
    if (/^(<{7}|={7}|>{7})/mu.test(resolution.resolved_content)) {
      throw new Error(`${path} still contains conflict markers`);
    }
    NodeFS.mkdirSync(NodePath.dirname(NodePath.resolve(path)), { recursive: true });
    NodeFS.writeFileSync(path, resolution.resolved_content);
    git(["add", "--", path]);
  }

  process.stdout.write(
    `[fork-sync] resolved ${path} with ${MODEL} (requested tier=${SERVICE_TIER}, effective tier=${apiResponse.service_tier ?? "unknown"}): ${resolution.summary}\n`,
  );
}

async function main() {
  const token = process.env.CLI_PROXY_API_KEY?.trim();
  if (!token) throw new Error("CLI_PROXY_API_KEY is required when merge conflicts exist");

  const paths = git(["diff", "--name-only", "--diff-filter=U"]).split("\n").filter(Boolean);
  if (paths.length === 0) {
    process.stdout.write("[fork-sync] no unresolved paths\n");
    return;
  }
  if (paths.length > MAX_CONFLICTS) {
    throw new Error(`Refusing to resolve ${paths.length} conflicts; limit is ${MAX_CONFLICTS}`);
  }

  const unmergedModes = git(["ls-files", "-u"]);
  for (const path of paths) {
    const entries = unmergedModes.split("\n").filter((line) => line.endsWith(`\t${path}`));
    if (entries.some((entry) => !entry.startsWith("100644 ") && !entry.startsWith("100755 "))) {
      throw new Error(`${path} has a non-regular git mode and requires manual resolution`);
    }
    await resolveConflict(path, token);
  }

  const remaining = git(["diff", "--name-only", "--diff-filter=U"]).trim();
  if (remaining) throw new Error(`Unresolved paths remain:\n${remaining}`);
}

main().catch((error) => {
  process.stderr.write(`[fork-sync] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
