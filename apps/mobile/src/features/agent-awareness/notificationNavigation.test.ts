import type { NotificationResponse } from "expo-notifications";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { ENTITY_ID_MAX_LENGTH } from "@t3tools/contracts";

import {
  consumeLastAgentNotificationResponse,
  shouldConsumeLastAgentNotificationResponse,
} from "./notificationResponseConsumer";

import {
  extractAgentNotificationDeepLink,
  routeAgentNotificationResponseOnce,
} from "./notificationPayload";

function responseWithData(data: Record<string, unknown>, identifier = "notification-1") {
  return {
    notification: {
      request: {
        identifier,
        content: {
          data,
        },
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("consumeLastAgentNotificationResponse", () => {
  it("rejects a stale cold-start response after a newer live response arrives", () => {
    const stale = responseWithData({}, "notification-old") as NotificationResponse;

    expect(shouldConsumeLastAgentNotificationResponse(stale, "notification-new")).toBe(false);
    expect(shouldConsumeLastAgentNotificationResponse(stale, "notification-old")).toBe(true);
    expect(shouldConsumeLastAgentNotificationResponse(stale, null)).toBe(true);
  });

  it("reports which initial-response operation failed", async () => {
    const cause = new Error("notification lookup unavailable");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    await consumeLastAgentNotificationResponse({
      getLastResponse: () => Promise.reject(cause),
      clearLastResponse: () => Promise.resolve(),
      handleResponse: vi.fn(),
    });

    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "NotificationNavigationError",
        operation: "read",
      }),
    );
  });

  it("routes a response before reporting a clear failure", async () => {
    const cause = new Error("notification clear unavailable");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = responseWithData({}, "notification-clear") as NotificationResponse;
    const handleResponse = vi.fn();

    await consumeLastAgentNotificationResponse({
      getLastResponse: () => Promise.resolve(response),
      clearLastResponse: () => Promise.reject(cause),
      handleResponse,
    });

    expect(handleResponse).toHaveBeenCalledWith(response);
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "NotificationNavigationError",
        operation: "clear",
        notificationId: "notification-clear",
      }),
    );
  });

  it("reports routing failures before clearing the response", async () => {
    const cause = new Error("notification routing unavailable");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = responseWithData({}, "notification-route") as NotificationResponse;
    const clearLastResponse = vi.fn(() => Promise.resolve());

    await consumeLastAgentNotificationResponse({
      getLastResponse: () => Promise.resolve(response),
      clearLastResponse,
      handleResponse: () => {
        throw cause;
      },
    });

    expect(clearLastResponse).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(
      expect.objectContaining({
        _tag: "NotificationNavigationError",
        operation: "route",
        notificationId: "notification-route",
      }),
    );
  });

  it("keeps an initial response when its navigation owner unmounts before routing", async () => {
    const response = responseWithData({}, "notification-deferred") as NotificationResponse;
    const clearLastResponse = vi.fn(() => Promise.resolve());

    await consumeLastAgentNotificationResponse({
      getLastResponse: () => Promise.resolve(response),
      clearLastResponse,
      handleResponse: () => false,
    });

    expect(clearLastResponse).not.toHaveBeenCalled();
  });
});

describe("extractAgentNotificationDeepLink", () => {
  it("uses explicit deep links from APNs payload data", () => {
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({
          deepLink: "/threads/env/thread",
          environmentId: "ignored",
          threadId: "ignored",
        }),
      ),
    ).toBe("/threads/env/thread");
  });

  it("normalizes explicit thread deep links from APNs payload data", () => {
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({
          deepLink: "/threads/env%201/thread%2F2",
        }),
      ),
    ).toBe("/threads/env%201/thread%2F2");
  });

  it("falls back to the thread route from environment and thread ids", () => {
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({
          environmentId: "env 1",
          threadId: "thread/2",
        }),
      ),
    ).toBe("/threads/env%201/thread%2F2");
  });

  it("falls back to ids when explicit deep link is not an agent thread route", () => {
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({
          deepLink: "/",
          environmentId: "env",
          threadId: "thread",
        }),
      ),
    ).toBe("/threads/env/thread");
  });

  it("ignores malformed or external links", () => {
    expect(
      extractAgentNotificationDeepLink(responseWithData({ deepLink: "https://example.com" })),
    ).toBeNull();
    expect(
      extractAgentNotificationDeepLink(responseWithData({ deepLink: "/settings" })),
    ).toBeNull();
    expect(
      extractAgentNotificationDeepLink(responseWithData({ deepLink: "//example.com" })),
    ).toBeNull();
    expect(
      extractAgentNotificationDeepLink(responseWithData({ deepLink: "/threads/env/thread?x=1" })),
    ).toBeNull();
    expect(extractAgentNotificationDeepLink({})).toBeNull();
  });

  it("rejects oversized notification route identifiers before encoding them", () => {
    const oversized = "e".repeat(ENTITY_ID_MAX_LENGTH + 1);

    expect(
      extractAgentNotificationDeepLink(
        responseWithData({ environmentId: oversized, threadId: "thread" }),
      ),
    ).toBeNull();
    expect(
      extractAgentNotificationDeepLink(
        responseWithData({ deepLink: `/threads/${oversized}/thread` }),
      ),
    ).toBeNull();
  });
});

describe("routeAgentNotificationResponseOnce", () => {
  it("keeps a response retryable when navigation fails", () => {
    const handledResponseIds = new Set<string>();
    const response = responseWithData(
      { environmentId: "env", threadId: "thread" },
      "notification-retry",
    );

    expect(() =>
      routeAgentNotificationResponseOnce({
        handledResponseIds,
        response,
        navigate: () => {
          throw new Error("navigation is not ready");
        },
      }),
    ).toThrow("navigation is not ready");
    expect(handledResponseIds.has("notification-retry")).toBe(false);

    const navigate = vi.fn();
    routeAgentNotificationResponseOnce({ handledResponseIds, response, navigate });
    expect(navigate).toHaveBeenCalledWith("/threads/env/thread");
    expect(handledResponseIds.has("notification-retry")).toBe(true);
  });

  it("does not navigate twice when the initial and listener responses refer to one notification", () => {
    const handledResponseIds = new Set<string>();
    const navigations: Array<string> = [];
    const response = responseWithData({
      environmentId: "env",
      threadId: "thread",
    });

    routeAgentNotificationResponseOnce({
      handledResponseIds,
      response,
      navigate: (deepLink) => navigations.push(deepLink),
    });
    routeAgentNotificationResponseOnce({
      handledResponseIds,
      response,
      navigate: (deepLink) => navigations.push(deepLink),
    });

    expect(navigations).toEqual(["/threads/env/thread"]);
  });

  it("bounds response deduplication history for long-running sessions", () => {
    const handledResponseIds = new Set<string>();

    for (let index = 0; index < 129; index += 1) {
      routeAgentNotificationResponseOnce({
        handledResponseIds,
        response: responseWithData(
          { environmentId: "env", threadId: `thread-${index}` },
          `notification-${index}`,
        ),
        navigate: () => undefined,
      });
    }

    expect(handledResponseIds.size).toBe(128);
    expect(handledResponseIds.has("notification-0")).toBe(false);
    expect(handledResponseIds.has("notification-128")).toBe(true);
  });
});
