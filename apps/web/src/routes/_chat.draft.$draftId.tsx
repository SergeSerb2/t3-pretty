import { createFileRoute } from "@tanstack/react-router";

import { ThreadRouteView } from "./-threadRouteView";

export const Route = createFileRoute("/_chat/draft/$draftId")({
  component: ThreadRouteView,
});
