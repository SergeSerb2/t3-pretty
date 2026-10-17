import {
  EnvironmentId,
  OrchestratorMcpFailure,
  RemoteContextPeers,
  RemoteContextResult,
  RemoteContextSendInput,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import * as RemoteContext from "../../../relay/RemoteContext.ts";
import * as McpContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpContext.McpInvocationContext,
    Threads.ThreadManagementService,
    RemoteContext.RemoteContext,
  ],
};
const Peers = Tool.make("t3_remote_connections", {
  ...shared,
  description:
    "Find other environments linked to the same Connect account. Returns IDs and labels, without credentials. A listed environment can be offline.",
  success: RemoteContextPeers,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);
const Search = Tool.make("t3_remote_threads", {
  ...shared,
  description:
    "Find up to 50 active threads on a Connect environment. Filter by title with query. Use the returned threadId with t3_remote_send. This reads titles and permission modes only.",
  parameters: Schema.Struct({
    environmentId: EnvironmentId,
    query: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  }),
  success: RemoteContextResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.OpenWorld, true);
const Send = Tool.make("t3_remote_send", {
  ...shared,
  description:
    "Send a message, code context, and selected workspace files to a thread on another Connect environment. Use when the user asks, or when a remote thread needs this context for the current task. Files must be relative to this thread's workspace. Limits: 8 files, 2 MiB each, 8 MiB total. maxBytes can lower the total limit. Known credential files, repository metadata, and dependency caches are excluded. Files with multiple hard links cannot be shared. Files become destination thread attachments. The destination cannot run with broader permission modes. Reuse clientRequestId only for an identical retry. A send starts an idle thread or steers or queues an active thread. Success means message acceptance. File support depends on the destination provider. Never send acknowledgements in a loop.",
  parameters: RemoteContextSendInput,
  success: RemoteContextResult,
})
  .annotate(Tool.Destructive, true)
  .annotate(Tool.OpenWorld, true);

export const RemoteContextToolkit = Toolkit.make(Peers, Search, Send);
