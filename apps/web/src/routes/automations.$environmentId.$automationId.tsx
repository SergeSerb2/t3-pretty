import { AutomationId, EnvironmentId } from "@t3tools/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { AutomationPage } from "../components/automations/AutomationPage";

export const Route = createFileRoute("/automations/$environmentId/$automationId")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: AutomationRouteView,
});

function AutomationRouteView() {
  const params = Route.useParams();
  return (
    <AutomationPage
      environmentId={EnvironmentId.make(params.environmentId)}
      automationId={AutomationId.make(params.automationId)}
    />
  );
}
