#!/usr/bin/env node

import { createClerkClient } from "@clerk/backend";

export const DESKTOP_CLERK_ALLOWED_ORIGINS = ["t3code://app", "t3code-dev://app"] as const;

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
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("CLERK_SECRET_KEY is required to configure Clerk desktop origins.");
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
