#!/usr/bin/env node

import { createClerkClient } from "@clerk/backend";

export const DESKTOP_CLERK_ALLOWED_ORIGINS = ["t3code://app", "t3code-dev://app"] as const;

export function resolveClerkSecretKey(raw: string | undefined): string | undefined {
  const secretKey = raw?.trim();
  if (!secretKey || Buffer.byteLength(secretKey, "utf8") > 8192) return undefined;
  for (const character of secretKey) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return undefined;
  }
  return secretKey;
}

export interface ClerkInstanceClient {
  readonly instance: {
    readonly get: () => Promise<{ readonly allowedOrigins: ReadonlyArray<string> | null }>;
    readonly update: (input: { readonly allowedOrigins: Array<string> }) => Promise<void>;
  };
}

export function mergeClerkAllowedOrigins(
  current: ReadonlyArray<string> | null,
  required: ReadonlyArray<string> = DESKTOP_CLERK_ALLOWED_ORIGINS,
): Array<string> {
  return Array.from(new Set([...(current ?? []), ...required]));
}

export async function reconcileClerkAllowedOrigins(
  client: ClerkInstanceClient,
): Promise<{ readonly changed: boolean; readonly allowedOrigins: ReadonlyArray<string> }> {
  const instance = await client.instance.get();
  const current = instance.allowedOrigins ?? [];
  const allowedOrigins = mergeClerkAllowedOrigins(current);
  const changed =
    allowedOrigins.length !== current.length ||
    allowedOrigins.some((origin, index) => origin !== current[index]);

  if (changed) {
    await client.instance.update({ allowedOrigins });
  }

  return { changed, allowedOrigins };
}

async function main(): Promise<void> {
  const secretKey = resolveClerkSecretKey(process.env.CLERK_SECRET_KEY);
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is missing or outside its safety boundary.");
  }

  const result = await reconcileClerkAllowedOrigins(createClerkClient({ secretKey }));
  process.stdout.write(
    result.changed
      ? "Configured Clerk desktop origins.\n"
      : "Clerk desktop origins are already configured.\n",
  );
}

if (import.meta.main) {
  await main();
}
