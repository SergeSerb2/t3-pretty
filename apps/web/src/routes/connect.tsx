import { createFileRoute, redirect } from "@tanstack/react-router";

import { connectCliAuthRoutesEnabled } from "../cloud/connectCliAuth";
import { connectBrowserAuthHandoffUrl } from "../cloud/browserAuth";
import { ConnectCliAuthorizeSurface } from "../components/cloud/ConnectCliAuthSurface";

export const Route = createFileRoute("/connect")({
  beforeLoad: () => {
    const handoffUrl = connectBrowserAuthHandoffUrl();
    if (handoffUrl !== null) {
      throw redirect({ href: handoffUrl, replace: true });
    }
    if (!connectCliAuthRoutesEnabled()) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: ConnectCliAuthorizeSurface,
});
