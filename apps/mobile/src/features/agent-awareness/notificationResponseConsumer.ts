import type { NotificationResponse } from "expo-notifications";
import * as Schema from "effect/Schema";

export class NotificationNavigationError extends Schema.TaggedErrorClass<NotificationNavigationError>()(
  "NotificationNavigationError",
  {
    operation: Schema.Literals(["read", "route", "clear"]),
    notificationId: Schema.optional(Schema.String),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} the last notification response.`;
  }
}

export function shouldConsumeLastAgentNotificationResponse(
  response: NotificationResponse,
  latestLiveResponseId: string | null,
): boolean {
  return (
    latestLiveResponseId === null ||
    response.notification.request.identifier === latestLiveResponseId
  );
}

export async function consumeLastAgentNotificationResponse(input: {
  readonly getLastResponse: () => Promise<NotificationResponse | null>;
  readonly clearLastResponse: () => Promise<void>;
  /** Return false when the navigation owner disappeared before consumption. */
  readonly handleResponse: (response: NotificationResponse) => boolean | void;
}): Promise<void> {
  let response: NotificationResponse | null;
  try {
    response = await input.getLastResponse();
  } catch (cause) {
    console.error(new NotificationNavigationError({ operation: "read", cause }));
    return;
  }

  if (!response) {
    return;
  }

  try {
    if (input.handleResponse(response) === false) {
      return;
    }
  } catch (cause) {
    console.error(
      new NotificationNavigationError({
        operation: "route",
        notificationId: response.notification.request.identifier,
        cause,
      }),
    );
    return;
  }

  try {
    await input.clearLastResponse();
  } catch (cause) {
    console.error(
      new NotificationNavigationError({
        operation: "clear",
        notificationId: response.notification.request.identifier,
        cause,
      }),
    );
  }
}
