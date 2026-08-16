import { createFileRoute } from "@tanstack/react-router";

import { AgentsSettingsPanel } from "../components/settings/AgentsSettings";

export const Route = createFileRoute("/settings/agents")({
  component: AgentsSettingsPanel,
});
