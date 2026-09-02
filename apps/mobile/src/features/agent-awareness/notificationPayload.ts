import { ENTITY_ID_MAX_LENGTH } from "@t3tools/contracts";

const ENCODED_ENTITY_ID_MAX_LENGTH = ENTITY_ID_MAX_LENGTH * 6;
const THREAD_DEEP_LINK_MAX_LENGTH = "/threads//".length + ENCODED_ENTITY_ID_MAX_LENGTH * 2;

function dataFromNotificationResponse(response: unknown): Record<string, unknown> | null {
  if (typeof response !== "object" || response === null) {
    return null;
  }
  const notification = (response as { readonly notification?: unknown }).notification;
  if (typeof notification !== "object" || notification === null) {
    return null;
  }
  const request = (notification as { readonly request?: unknown }).request;
  if (typeof request !== "object" || request === null) {
    return null;
  }
  const content = (request as { readonly content?: unknown }).content;
  if (typeof content !== "object" || content === null) {
    return null;
  }
  const data = (content as { readonly data?: unknown }).data;
  return typeof data === "object" && data !== null ? (data as Record<string, unknown>) : null;
}

function identifierFromNotificationResponse(response: unknown): string | null {
  if (typeof response !== "object" || response === null) {
    return null;
  }
  const notification = (response as { readonly notification?: unknown }).notification;
  if (typeof notification !== "object" || notification === null) {
    return null;
  }
  const request = (notification as { readonly request?: unknown }).request;
  if (typeof request !== "object" || request === null) {
    return null;
  }
  const identifier = (request as { readonly identifier?: unknown }).identifier;
  return typeof identifier === "string" && identifier.length <= ENTITY_ID_MAX_LENGTH
    ? identifier
    : null;
}

const MAX_HANDLED_NOTIFICATION_RESPONSE_IDS = 128;

function rememberHandledNotificationResponseId(
  handledResponseIds: Set<string>,
  responseId: string,
) {
  while (handledResponseIds.size >= MAX_HANDLED_NOTIFICATION_RESPONSE_IDS) {
    const oldestResponseId = handledResponseIds.values().next().value;
    if (oldestResponseId === undefined) {
      break;
    }
    handledResponseIds.delete(oldestResponseId);
  }
  handledResponseIds.add(responseId);
}

function encodeThreadDeepLink(input: {
  readonly environmentId: string;
  readonly threadId: string;
}): string | null {
  if (
    input.environmentId.length === 0 ||
    input.environmentId.length > ENTITY_ID_MAX_LENGTH ||
    input.threadId.length === 0 ||
    input.threadId.length > ENTITY_ID_MAX_LENGTH
  ) {
    return null;
  }
  return `/threads/${encodeURIComponent(input.environmentId)}/${encodeURIComponent(input.threadId)}`;
}

function normalizeThreadDeepLink(value: string): string | null {
  if (
    value.length > THREAD_DEEP_LINK_MAX_LENGTH ||
    value.trim() !== value ||
    value.startsWith("//") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return null;
  }

  const parts = value.split("/");
  if (parts.length !== 4 || parts[0] !== "" || parts[1] !== "threads") {
    return null;
  }

  try {
    return encodeThreadDeepLink({
      environmentId: decodeURIComponent(parts[2] ?? ""),
      threadId: decodeURIComponent(parts[3] ?? ""),
    });
  } catch {
    return null;
  }
}

export function extractAgentNotificationDeepLink(response: unknown): string | null {
  const data = dataFromNotificationResponse(response);
  const deepLink = data?.deepLink;
  if (typeof deepLink === "string") {
    const normalizedDeepLink = normalizeThreadDeepLink(deepLink);
    if (normalizedDeepLink) {
      return normalizedDeepLink;
    }
  }

  const environmentId = data?.environmentId;
  const threadId = data?.threadId;
  if (typeof environmentId === "string" && typeof threadId === "string") {
    return encodeThreadDeepLink({ environmentId, threadId });
  }
  return null;
}

export function routeAgentNotificationResponseOnce(input: {
  readonly handledResponseIds: Set<string>;
  readonly response: unknown;
  readonly navigate: (deepLink: string) => void;
}): void {
  const responseId = identifierFromNotificationResponse(input.response);
  if (responseId && input.handledResponseIds.has(responseId)) {
    return;
  }
  const deepLink = extractAgentNotificationDeepLink(input.response);
  if (deepLink) {
    input.navigate(deepLink);
  }
  // Commit the dedupe marker only after routing succeeds. The cold-response
  // consumer deliberately leaves a response persisted when navigation throws;
  // marking it first would make the retry skip navigation and then clear the
  // only recoverable copy.
  if (responseId) {
    rememberHandledNotificationResponseId(input.handledResponseIds, responseId);
  }
}
