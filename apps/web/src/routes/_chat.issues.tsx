import { createFileRoute } from "@tanstack/react-router";
import { IssuesWorkspace } from "~/components/issues/IssuesWorkspace";

export const Route = createFileRoute("/_chat/issues")({ component: IssuesWorkspace });
