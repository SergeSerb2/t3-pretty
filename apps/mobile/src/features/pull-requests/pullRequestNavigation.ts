import type {
  PullRequestRef,
  PullRequestReviewVerdict,
  RepositoryIdentity,
} from "@t3tools/contracts";
import { ENTITY_ID_MAX_LENGTH, EnvironmentId, ProjectId } from "@t3tools/contracts";

import {
  findProjectForChangeRequest,
  parseChangeRequestUrl,
  repositoryFromIdentity,
} from "./pullRequestLinks";

export type PullRequestDetailRouteParams = {
  readonly environmentId: string;
  readonly projectId: string;
  readonly number: string;
  /**
   * `owner/repo` travels as a navigate extra, not a linking path segment: a slash in the
   * name would split the URL. Deep links omit it and the project identity fills it in.
   */
  readonly repository?: string;
};

export type PullRequestCommentRouteParams = PullRequestDetailRouteParams & {
  readonly mode: "comment" | "review" | "reply";
  readonly threadId?: string;
  /** Intersected host ∩ viewer verdicts. Absent on a deep link, which offers Comment only. */
  readonly verdicts?: ReadonlyArray<PullRequestReviewVerdict>;
};

export type PullRequestDiffRouteParams = PullRequestDetailRouteParams & {
  readonly path?: string;
};

const PULL_REQUEST_ROUTE_REPOSITORY_MAX_LENGTH = ENTITY_ID_MAX_LENGTH;
const PULL_REQUEST_ROUTE_FILE_PATH_MAX_LENGTH = ENTITY_ID_MAX_LENGTH;
const PULL_REQUEST_ROUTE_URL_MAX_LENGTH = 8_192;
const INVALID_PULL_REQUEST_ROUTE_ENVIRONMENT_ID = EnvironmentId.make("invalid-pull-request-route");

function normalizeBoundedRouteValue(value: string, maxLength: number): string | null {
  if (value.length > maxLength) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength ? trimmed : null;
}

export function resolvePullRequestRouteEnvironmentId(value: string): EnvironmentId {
  const normalized = normalizeBoundedRouteValue(value, ENTITY_ID_MAX_LENGTH);
  return normalized === null
    ? INVALID_PULL_REQUEST_ROUTE_ENVIRONMENT_ID
    : EnvironmentId.make(normalized);
}

export function normalizePullRequestDiffRoutePath(value: string | undefined): string | null {
  if (value === undefined) return null;
  return value.length > 0 && value.length <= PULL_REQUEST_ROUTE_FILE_PATH_MAX_LENGTH ? value : null;
}

export function normalizePullRequestRouteThreadId(value: string | undefined): string | null {
  if (value === undefined) return null;
  return normalizeBoundedRouteValue(value, ENTITY_ID_MAX_LENGTH);
}

export function parseRoutePositiveInt(value: string | number | undefined): number | null {
  if (typeof value === "string" && !/^[1-9]\d{0,15}$/u.test(value)) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function resolvePullRequestRouteRepository(input: {
  readonly repository?: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly projects: ReadonlyArray<{
    readonly environmentId: unknown;
    readonly id: unknown;
    readonly repositoryIdentity?: Pick<RepositoryIdentity, "displayName" | "owner" | "name"> | null;
  }>;
}): string | null {
  const environmentId = normalizeBoundedRouteValue(input.environmentId, ENTITY_ID_MAX_LENGTH);
  const projectId = normalizeBoundedRouteValue(input.projectId, ENTITY_ID_MAX_LENGTH);
  if (environmentId === null || projectId === null) return null;
  if (input.repository !== undefined) {
    return normalizeBoundedRouteValue(input.repository, PULL_REQUEST_ROUTE_REPOSITORY_MAX_LENGTH);
  }
  const project = input.projects.find(
    (candidate) =>
      String(candidate.environmentId) === environmentId && String(candidate.id) === projectId,
  );
  const repository = repositoryFromIdentity(project?.repositoryIdentity ?? null);
  return repository === null
    ? null
    : normalizeBoundedRouteValue(repository, PULL_REQUEST_ROUTE_REPOSITORY_MAX_LENGTH);
}

export function resolvePullRequestRouteReference(
  params: PullRequestDetailRouteParams,
  projects: ReadonlyArray<{
    readonly environmentId: unknown;
    readonly id: unknown;
    readonly repositoryIdentity?: Pick<RepositoryIdentity, "displayName" | "owner" | "name"> | null;
  }>,
): PullRequestRef | null {
  const number = parseRoutePositiveInt(params.number);
  const environmentId = normalizeBoundedRouteValue(params.environmentId, ENTITY_ID_MAX_LENGTH);
  const projectId = normalizeBoundedRouteValue(params.projectId, ENTITY_ID_MAX_LENGTH);
  if (environmentId === null || projectId === null) return null;
  const repository = resolvePullRequestRouteRepository({
    repository: params.repository,
    environmentId,
    projectId,
    projects,
  });
  if (number === null || repository === null) return null;
  return {
    projectId: ProjectId.make(projectId),
    repository,
    number,
  };
}

/**
 * The native detail route for a change request the git status already knows about, or null
 * when the URL is not a host this page can read and the project has no repository identity
 * to fall back on. Null means the system browser.
 */
export function resolveNativePullRequestTarget(input: {
  readonly environmentId: string;
  readonly projectId: string;
  readonly url: string;
  readonly number?: number | null;
  readonly repositoryIdentity?: Pick<RepositoryIdentity, "displayName" | "owner" | "name"> | null;
}): PullRequestDetailRouteParams | null {
  const environmentId = normalizeBoundedRouteValue(input.environmentId, ENTITY_ID_MAX_LENGTH);
  const projectId = normalizeBoundedRouteValue(input.projectId, ENTITY_ID_MAX_LENGTH);
  if (
    environmentId === null ||
    projectId === null ||
    input.url.length > PULL_REQUEST_ROUTE_URL_MAX_LENGTH
  ) {
    return null;
  }
  const parsed = parseChangeRequestUrl(input.url);
  const repositoryValue =
    parsed?.repository ?? repositoryFromIdentity(input.repositoryIdentity ?? null);
  const repository =
    repositoryValue === null
      ? null
      : normalizeBoundedRouteValue(repositoryValue, PULL_REQUEST_ROUTE_REPOSITORY_MAX_LENGTH);
  const number = parseRoutePositiveInt(parsed?.number ?? input.number ?? undefined);
  if (repository === null || number === null) return null;
  return {
    environmentId,
    projectId,
    repository,
    number: String(number),
  };
}

/**
 * The native detail route for a change-request URL this environment can read,
 * or null when the link should stay in the system browser.
 *
 * Prefers a project whose repository identity matches the host and path. When
 * none does and the current thread's project has no identity to compare, that
 * project stands in so an agent-created pull request still opens in-app.
 */
export function resolveChangeRequestRoute(input: {
  readonly environmentId: string;
  readonly url: string;
  readonly pullRequestsSupported: boolean;
  readonly projects: ReadonlyArray<{
    readonly environmentId: unknown;
    readonly id: unknown;
    readonly repositoryIdentity?: Pick<
      RepositoryIdentity,
      "canonicalKey" | "displayName" | "owner" | "name" | "provider"
    > | null;
  }>;
  readonly fallbackProjectId?: string;
}): PullRequestDetailRouteParams | null {
  const environmentId = normalizeBoundedRouteValue(input.environmentId, ENTITY_ID_MAX_LENGTH);
  if (
    !input.pullRequestsSupported ||
    environmentId === null ||
    input.url.length > PULL_REQUEST_ROUTE_URL_MAX_LENGTH
  ) {
    return null;
  }
  const parsed = parseChangeRequestUrl(input.url);
  if (parsed === null) return null;
  const projects = input.projects.filter(
    (project) => String(project.environmentId) === environmentId,
  );
  const matched = findProjectForChangeRequest(projects, parsed);
  const fallback =
    matched === undefined
      ? projects.find(
          (candidate) =>
            String(candidate.id) === input.fallbackProjectId &&
            candidate.repositoryIdentity == null,
        )
      : undefined;
  const project = matched ?? fallback;
  if (project === undefined) return null;
  const projectId = normalizeBoundedRouteValue(String(project.id), ENTITY_ID_MAX_LENGTH);
  const repositoryValue =
    repositoryFromIdentity(project.repositoryIdentity ?? null) ?? parsed.repository;
  const repository = normalizeBoundedRouteValue(
    repositoryValue,
    PULL_REQUEST_ROUTE_REPOSITORY_MAX_LENGTH,
  );
  if (projectId === null || repository === null) return null;
  return {
    environmentId,
    projectId,
    repository,
    number: String(parsed.number),
  };
}
