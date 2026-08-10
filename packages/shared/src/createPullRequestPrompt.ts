/**
 * Canned "open a pull request" instruction for the agent, appended to an
 * outgoing composer message when the client's auto-PR toggle is on (or the
 * thread starts in a fresh worktree). It travels as plain user-message text so
 * it behaves identically across providers, but it is wrapped in a marker block
 * so the UI can hide it from the user's chat bubble.
 */

export const CREATE_PULL_REQUEST_TAG = "create_pull_request_instructions";

export type AutoCreatePullRequestEnvMode = "local" | "worktree";

/**
 * Worktree threads default to auto-PR on: a fresh worktree exists to produce a
 * branch, and its work is expected to land as a pull request. Local threads
 * default off. Shared so every client resolves the same defaults.
 */
export const AUTO_CREATE_PULL_REQUEST_DEFAULTS: Record<AutoCreatePullRequestEnvMode, boolean> = {
  local: false,
  worktree: true,
};

export function resolveAutoCreatePullRequest(
  byEnvMode: Partial<Record<AutoCreatePullRequestEnvMode, boolean | undefined>> | null | undefined,
  envMode: AutoCreatePullRequestEnvMode,
): boolean {
  const stored = byEnvMode?.[envMode];
  return typeof stored === "boolean" ? stored : AUTO_CREATE_PULL_REQUEST_DEFAULTS[envMode];
}

const OPEN_TAG = `<${CREATE_PULL_REQUEST_TAG}>`;
const CLOSE_TAG = `</${CREATE_PULL_REQUEST_TAG}>`;

const GUIDELINES = `Guidelines:
- Before opening the PR, bring this worktree/branch up to date: fetch origin and merge (or rebase) the repository's default branch (usually origin/main) into the current branch, resolving any conflicts sensibly.
- Review the full diff of this branch before writing anything.
- Commit any uncommitted changes with clear, conventional commit messages.
- Push the branch and open the PR against the repository's default branch.
- Use a concise, imperative PR title.
- In the PR body, summarize what changed and why, and note how it was verified.
- Follow the repository's PR template and contribution guidelines if present.`;

/** Sent on its own when the user asks for a PR without other work. */
export const CREATE_PULL_REQUEST_PROMPT = `Please create a pull request for the work in this session.

${GUIDELINES}`;

/**
 * Appended to an outgoing message when the auto-PR toggle is on. The leading
 * blank lines separate it from the user's own text; the marker tags let the
 * timeline strip it before rendering the bubble.
 */
export const CREATE_PULL_REQUEST_MESSAGE_SUFFIX = `

${OPEN_TAG}
When you finish the work above, also create a pull request for it.

${GUIDELINES}
${CLOSE_TAG}`;

/**
 * Appends the auto-PR instruction when it applies. Empty drafts are left alone
 * so the suffix can never become the entire message, and the suffix is only
 * added to a thread's first user message — follow-ups in a thread that is
 * already underway should not keep re-sending the guidelines.
 *
 * Idempotent: re-queueing a message that already carries the suffix (editing a
 * pending task rehydrates the stored text into the draft) must not stack a
 * second copy.
 */
export function applyCreatePullRequestSuffix(input: {
  readonly text: string;
  readonly autoCreatePullRequest: boolean;
  readonly threadHasStarted: boolean;
}): string {
  if (
    !input.autoCreatePullRequest ||
    input.threadHasStarted ||
    input.text.trim().length === 0 ||
    hasCreatePullRequestSuffix(input.text)
  ) {
    return input.text;
  }
  return input.text + CREATE_PULL_REQUEST_MESSAGE_SUFFIX;
}

export function hasCreatePullRequestSuffix(text: string): boolean {
  return text.includes(OPEN_TAG);
}

/**
 * Removes the marker block for display so the user's chat bubble shows only
 * what they typed. Tolerant of historical wording changes: it strips any
 * content between the marker tags, not just the current suffix text.
 */
export function stripCreatePullRequestSuffix(text: string): string {
  if (!hasCreatePullRequestSuffix(text)) {
    return text;
  }
  let result = text;
  for (let start = result.indexOf(OPEN_TAG); start !== -1; start = result.indexOf(OPEN_TAG)) {
    const end = result.indexOf(CLOSE_TAG, start);
    const stop = end === -1 ? result.length : end + CLOSE_TAG.length;
    result = result.slice(0, start) + result.slice(stop);
  }
  return result.replace(/\n{3,}/g, "\n\n").trimEnd();
}
