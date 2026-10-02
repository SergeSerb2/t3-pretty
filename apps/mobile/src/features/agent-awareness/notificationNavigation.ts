import { useEffect, useLayoutEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { useLinkTo } from "@react-navigation/native";

import { routeAgentNotificationResponseOnce, threadDeepLinkOnScreen } from "./notificationPayload";
import {
  consumeLastAgentNotificationResponse,
  shouldConsumeLastAgentNotificationResponse,
} from "./notificationResponseConsumer";

// Notification responses are process-level native events. Keep their bounded
// dedupe history across navigation-root remounts so a failed native clear or a
// development Strict Mode remount cannot route the same tap twice.
const handledAgentNotificationResponseIds = new Set<string>();
import { setAndroidThreadOnScreen } from "./androidNotifications";
import { foregroundNotificationBehavior } from "./foregroundNotificationBehavior";

export function useAgentNotificationNavigation(pathname: string): void {
  const linkTo = useLinkTo();
  // Read through a ref so the native handler registered once below sees the
  // current route without re-registering on every navigation.
  const deepLinkOnScreen = useRef<string | null>(null);
  useLayoutEffect(() => {
    const thread = threadDeepLinkOnScreen(pathname);
    deepLinkOnScreen.current = thread;
    // Android alerts are built natively from FCM data, so update the native
    // route at commit time alongside the iOS handler's route reference.
    setAndroidThreadOnScreen(thread);
  }, [pathname]);

  useEffect(() => {
    Notifications.setNotificationHandler({
      handleNotification: (notification) =>
        Promise.resolve(foregroundNotificationBehavior(notification, deepLinkOnScreen.current)),
    });
    return () => {
      Notifications.setNotificationHandler(null);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let latestLiveResponseId: string | null = null;
    const routeResponse = (response: Notifications.NotificationResponse): boolean => {
      if (!active) {
        return false;
      }
      routeAgentNotificationResponseOnce({
        handledResponseIds: handledAgentNotificationResponseIds,
        response,
        navigate: linkTo,
      });
      return true;
    };

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      latestLiveResponseId = response.notification.request.identifier;
      routeResponse(response);
    });
    void consumeLastAgentNotificationResponse({
      getLastResponse: () => Notifications.getLastNotificationResponseAsync(),
      clearLastResponse: () => Notifications.clearLastNotificationResponseAsync(),
      handleResponse: (response) => {
        // The native cold-start lookup is asynchronous. If an in-session tap
        // arrived while it was pending, do not let an older persisted response
        // finish later and navigate back over that newer destination. A match
        // is still consumed: some native implementations surface the same
        // cold-start response through both paths.
        if (!shouldConsumeLastAgentNotificationResponse(response, latestLiveResponseId)) {
          return false;
        }
        return routeResponse(response);
      },
    });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [linkTo]);
}
