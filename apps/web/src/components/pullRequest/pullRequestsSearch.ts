import type {
  EnvironmentId,
  ProjectId,
  PullRequestInvolvement,
  PullRequestListFilters,
  PullRequestListState,
} from "@t3tools/contracts";

export interface PullRequestsSearch {
  readonly involvement: PullRequestInvolvement;
  readonly state: PullRequestListState;
  /**
   * Narrows the list to one server. Absent means every connected one, which is the default the
   * page has now — so a link written before servers could be chosen still opens the whole list.
   */
  readonly environmentId?: EnvironmentId;
  /** Scopes the list. Separate from the selection so one cannot silently change the other. */
  readonly projectId?: ProjectId;
  /**
   * Narrows the list to one host, named as the host itself: two GitHub installs are two
   * accounts, and their shared provider kind cannot tell them apart. Absent means every host.
   */
  readonly host?: string;
  readonly repository?: string;
  readonly number?: number;
  readonly selectedProjectId?: ProjectId;
  /**
   * Which server the selected pull request was read from. A project id only names a project on
   * its own server, so this is what tells two servers holding one project apart. Optional: a
   * link without it still opens, resolved by project id alone where that is unambiguous.
   */
  readonly selectedEnvironmentId?: EnvironmentId;
  readonly q?: string;
  /**
   * The narrowings beyond state and involvement, each absent when that group is unfiltered. Flat
   * in the URL because a link is read and edited by hand; folded into one record for the listing.
   */
  readonly draft?: "only" | "hide";
  readonly review?: NonNullable<PullRequestListFilters["review"]>;
  readonly checks?: NonNullable<PullRequestListFilters["checks"]>;
}

export type PullRequestsSearchPatch = {
  [Key in keyof PullRequestsSearch]?: PullRequestsSearch[Key] | undefined;
};

/**
 * Missing keys stay; `undefined` leaves the URL. Rebuilt rather than spread so a cleared
 * field is absent instead of lingering as an explicit `undefined`.
 */
export function applyPullRequestsSearchPatch(
  previous: PullRequestsSearch,
  patch: PullRequestsSearchPatch,
): PullRequestsSearch {
  const next = { ...previous, ...patch };
  return {
    involvement: next.involvement ?? previous.involvement,
    state: next.state ?? previous.state,
    ...(next.repository ? { repository: next.repository } : {}),
    ...(next.number ? { number: next.number } : {}),
    ...(next.projectId ? { projectId: next.projectId } : {}),
    ...(next.environmentId ? { environmentId: next.environmentId } : {}),
    ...(next.host ? { host: next.host } : {}),
    ...(next.selectedProjectId ? { selectedProjectId: next.selectedProjectId } : {}),
    ...(next.selectedEnvironmentId ? { selectedEnvironmentId: next.selectedEnvironmentId } : {}),
    ...(next.q ? { q: next.q } : {}),
    ...(next.draft ? { draft: next.draft } : {}),
    ...(next.review ? { review: next.review } : {}),
    ...(next.checks ? { checks: next.checks } : {}),
  };
}

/** Default unfiltered list. Keeps the typed query; drops every menu narrowing and selection. */
export function resetPullRequestsListSearch(previous: PullRequestsSearch): PullRequestsSearch {
  return {
    involvement: "all",
    state: "open",
    ...(previous.q ? { q: previous.q } : {}),
  };
}
