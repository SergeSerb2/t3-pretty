/**
 * Cursor Origin's client definition. Browser- and React Native-safe.
 *
 * Origin's server provider lives in the T3 Pretty server; this is the host
 * entry the shared registry needs so clone, publish, and change-request
 * surfaces keep offering Origin after the parent moved those paths onto
 * per-host definitions.
 *
 * @module client-runtime/originSourceControlClient
 */
import { pullRequestHostOf, SourceControlProviderKind } from "@t3tools/contracts";
import {
  defineSourceControlClient,
  isChangeRequestInProjectRepository,
  isChangeRequestOnProjectHost,
  isChangeRequestPath,
} from "@t3tools/source-control-core/client/definition";

const KIND = SourceControlProviderKind.make("origin");
const CHECKOUT_COMMAND = /^origin\s+pr\s+checkout\s+(.+)$/i;
const ORIGIN_WEB_HOSTS = new Set(["cursor.com", "www.cursor.com", "origin.cursor.com"]);
const CHANGE_REQUEST_REFERENCE =
  /^https:\/\/(?:www\.)?(?:origin\.)?cursor\.com\/codebase\/(?:[^/\s]+\/)+pull\/(\d+)(?:[/?#].*)?$/i;

function isOriginChangeRequestUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      ORIGIN_WEB_HOSTS.has(parsed.hostname.toLowerCase()) &&
      parsed.pathname.toLowerCase().includes("/codebase/") &&
      isChangeRequestPath(url, "/pull/")
    );
  } catch {
    return false;
  }
}

export const definition = defineSourceControlClient({
  kind: KIND,
  label: "Origin",
  pickerLabel: "Origin",
  icon: "origin",
  changeRequest: { shortLabel: "PR", singular: "pull request" },
  repositoryPathHint: "owner/repo",
  publicHost: "origin.cursor.com",
  publishDescription: "origin.cursor.com",
  publishHost: () => "origin.cursor.com",
  newRepositoryOwner: (account) => ({ owner: account }),
  defaultCloneTransport: "ssh",
  changeRequestUrl: ({ host, repository, number }) =>
    host === "origin.cursor.com" || host.endsWith(".origin.cursor.com")
      ? `https://cursor.com/codebase/${repository}/pull/${number}`
      : `https://${host}/codebase/${repository}/pull/${number}`,
  changeRequestActions: new Set([
    "merge",
    "ready",
    "draft",
    "close",
    "reopen",
    "enable-auto-merge",
    "disable-auto-merge",
  ] as const),
  checkoutCommand: ({ number }) => `origin pr checkout ${number}`,
  authorProfileUrl: () => null,
  referenceAutolinkRepositoryUrl: () => null,
  reviewSummaryRequired: () => false,
  checkoutCommandArgument: (input) => CHECKOUT_COMMAND.exec(input)?.[1]?.trim() ?? null,
  isChangeRequestReference: (url) => CHANGE_REQUEST_REFERENCE.test(url),
  changeRequestUrlHost: (url) => url.hostname,
  checkoutChangeRequestHost: (identity) => pullRequestHostOf(identity, KIND),
  isChangeRequestInRepository: (identity, link) =>
    isChangeRequestInProjectRepository(KIND, identity, link),
  canReadChangeRequestOnHost: (identity, link) =>
    isChangeRequestOnProjectHost(KIND, identity, link),
  isChangeRequestUrl: isOriginChangeRequestUrl,
});
