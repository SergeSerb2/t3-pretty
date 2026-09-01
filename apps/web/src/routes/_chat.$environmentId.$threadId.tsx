import { createFileRoute } from "@tanstack/react-router";

import { ThreadRouteView } from "./-threadRouteView";

export const Route = createFileRoute("/_chat/$environmentId/$threadId")({
  component: ThreadRouteView,
});
