import { RuntimeRequestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { splitPendingUserInputs } from "./pendingRequests.ts";
import type { ThreadPendingUserInput } from "./state/threadRequests.ts";
describe("V2 secret requests", () => {
 it("separates a masked API key prompt from ordinary input", () => {
  const request: ThreadPendingUserInput = { requestId: RuntimeRequestId.make("secret"), createdAt: "2026-10-02T00:00:00.000Z", responseCapability: "live", dismissible: false, questions: [{id:"key", header:"API key", question:"Connect the provider", options:[],multiSelect:false, secret:{name:"API_KEY"}}] };
  const normal = { ...request, requestId: RuntimeRequestId.make("normal"), questions: [{id:"choice",header:"Choice",question:"Choose",options:[],multiSelect:false}] };
  const split=splitPendingUserInputs([request,normal]);
  expect(split.userInputs).toEqual([normal]);
  expect(split.secretRequests).toEqual([{requestId:request.requestId,createdAt:request.createdAt,name:"API_KEY",header:"API key",purpose:"Connect the provider"}]);
 });
});
