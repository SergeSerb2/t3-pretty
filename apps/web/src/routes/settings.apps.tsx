import { createFileRoute } from "@tanstack/react-router";

import { AppsSettingsPanel } from "../components/settings/AppsSettings";

function SettingsAppsRoute() {
  return <AppsSettingsPanel />;
}

export const Route = createFileRoute("/settings/apps")({
  component: SettingsAppsRoute,
});
