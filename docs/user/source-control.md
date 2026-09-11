# Source control

T3 Code integrates with GitHub, GitLab, Bitbucket, Azure DevOps, and Origin to clone and publish
repositories, create pull requests, and review changes without leaving the app.

## Supported providers

- **GitHub** – Pull requests, repository creation, and clone integration
- **GitLab** – Merge requests, repository publishing, and hosted clones
- **Bitbucket** – Pull request workflows through API token authentication
- **Azure DevOps** – Pull request support for Microsoft-hosted repositories
- **Origin** – Cursor's git forge at `origin.cursor.com`, with pull request, clone, and publish support

## Connect an account

Install Git and configure authentication on the machine running your T3 Code server. For a remote
environment, do this on the remote machine. After signing in, open **Settings → Source Control**
and choose **Rescan**. This page shows which providers are ready, which setup is missing, and the
signed-in account when available. Rescan after changing credentials or setting up a new machine.

### GitHub

Install [GitHub CLI](https://cli.github.com/) 2.81.0 or newer, then sign in:

```bash
gh auth login
```

### GitLab

Install [GitLab CLI](https://gitlab.com/gitlab-org/cli), then sign in:

```bash
glab auth login
```

### Origin

Install the Origin CLI on the machine running T3 Code:

```bash
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh
```

Add `~/.local/bin` to your `PATH` if the shell cannot find `origin`, then sign in:

```bash
origin auth login
```

Origin remotes look like `https://origin.cursor.com/owner/repo.git`. Pull requests open at
`cursor.com/codebase`.

### Bitbucket

Set an access token in the server's environment:

```bash
export T3CODE_BITBUCKET_ACCESS_TOKEN="your-access-token"
```

Or use an Atlassian account email and API token with read/write access to repositories and pull
requests, plus user read access (`read:user:bitbucket`):

```bash
export T3CODE_BITBUCKET_EMAIL="you@example.com"
export T3CODE_BITBUCKET_API_TOKEN="your-token"
```

The access token takes precedence if both are configured. Restart the server after changing these
variables.

### Azure DevOps

Install [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/), add the DevOps extension, and sign in:

```bash
az extension add --name azure-devops
az login
```

## Clone or publish a project

Use **Add Project** in the command palette (`Cmd/Ctrl+K`) to clone a repository. Choose a hosting
provider or paste a Git URL, then choose where to save it.

Available choices include GitHub, GitLab, Bitbucket, Azure DevOps, and Origin. Depending on the
provider, enter a repository path such as `owner/repo`, `group/project`, `workspace/repository`, or
`project/repository`, or use a full Git URL.

For a local Git repository without a remote, **Publish Repository** creates a hosted repository,
adds it as `origin`, and pushes your commits. GitHub, GitLab, Bitbucket, Azure DevOps, and Origin are
supported. If there are no commits yet, it creates the remote; make your first commit before pushing.

## Create a pull request

Use a thread's Git actions to commit, push, and create a pull request. T3 Code can generate commit
messages, review titles, and descriptions from your changes and commits. GitHub, GitLab, Bitbucket,
Azure DevOps, and Origin are supported; GitLab calls these merge requests.

Choose the writing style and model in **Settings → Source Control**. **Repository conventions**
uses the project's instructions, including `AGENTS.md`, along with recent commit subjects. Claude
writers also follow `CLAUDE.md`.

## Review and merge

Open **Pull requests** to review changes and comments, request reviewers, check out a branch, or
merge. You can keep several reviews open as tabs in the right panel.

### Find and inspect reviews

- See whether the current branch already has an open PR/MR.
- When an agent finishes a turn on your thread's branch, T3 Code checks for a newly opened PR/MR if
  background activity is enabled for that repository. Known reviews keep their normal refresh
  schedule.
- Your authored reviews stay at the top and use the selected sort within their group. By default,
  passing and approved reviews come first, followed by passing reviews awaiting approval and then
  conflicting reviews. Smaller changes come first within each readiness group, and finished reviews
  follow open work when all states are visible.
- Filter by author or labels, rank authors by merges in the loaded results, see label and change-size
  context on each row, and sort the displayed results by readiness, update time, creation time, or
  change size.
- Filters, search, scope, and sort are restored when you return. **Reset filters** returns the list
  to open pull requests across every project. On iPhone and iPad the list always uses one server, so
  clearing the filters also returns to your preferred server.
- On iPhone and iPad, open **Pull Requests** from the home header or sidebar to browse, review,
  merge, comment, and resolve conflicts in the app. A thread's git controls and pull request links
  in the conversation open the same native manager instead of the host website.
- While working in a thread, open linked reviews in compact right-panel tabs without leaving the
  conversation. Origin pull requests at `cursor.com/codebase` open there the same way GitHub pull
  requests do.
- Show a file tree next to a review's **Code** tab or a thread's **Diff** panel to browse changed
  files as folders and jump directly to one. The toolbar toggle remembers your choice.
- Enable **Settings → General → Proactive panels** to open a newly linked review automatically and
  switch to the completed turn's diff when agent work finishes.
- Timeline line counts stay hidden on merge commits, where GitHub's totals include upstream changes
  brought in from the base branch.
- Open a review directly in your browser with one click. If a GitHub review cannot load, including
  because of rate limits, use **Open on GitHub** in the error view.
- Command-click a pull request number in the sidebar—or Control-click on Windows and Linux—to open
  it in the browser instead of T3 Code.
- Check out a teammate's branch to review the code locally.

### Merge and lifecycle

- Merge immediately or, on GitHub, GitLab, and Azure DevOps, leave an auto-merge instruction with a
  chosen strategy while checks are outstanding. The same control shows the completed state after
  the pull request merges.
- On GitHub, approve fork workflows that are waiting to run and open a revert pull request for a
  merged change.
- When a PR/MR closes without merging, its thread settles automatically across clients. A merged PR
  stays in the active list until you settle it. Pinned threads and threads you explicitly kept
  active remain in the active list.

### Work through review feedback

- On Origin pull requests, Grok auto-review summary cards stay hidden so the conversation focuses on
  findings and discussion. Use **Show auto-review summaries** when you want the write-ups.
- **Fix all** starts a thread that works through every unresolved review finding from GitHub,
  GitLab, Bitbucket, Azure DevOps, Origin, and Grok Origin comments, then resolves the conversations
  it fixed. Choose the agent and reasoning effort first. Per-comment **Fix in a thread** buttons
  still handle one finding at a time. The action stays hidden until unresolved review comments are
  present.
- **Fix continuously** starts the same focused sweep and keeps the agent watching latest-commit
  reviews and checks, fixing new actionable feedback until the pull request is green. It appears
  with **Fix all** only when unresolved review comments are present.
- On GitHub pull requests, emoji reactions appear on the description and comments, including
  Codex's eyes while it reviews and thumbs-up when it finishes without comments.
- Resolved review conversations collapse in the pull request conversation and on the diff. Use
  **Hide resolved** to hide them entirely.

### Codex auto-review status

For an open GitHub pull request, open the git menu beside the PR action to see Codex Auto Review's
public state: running, complete, feedback, an earlier result, or no public signal.

The indicator is based on activity GitHub exposes publicly: the connector's eyes reaction while
reviewing, thumbs-up when it finishes without comments, or a posted Codex review when it finds
issues. **No public signal** is intentionally not labeled as “skipped”: it can also mean Smart Review
is still deciding or Auto Review is disabled. Codex's current Smart Review setting remains the
source of truth for that configuration.

### Edit review content in place

- Comment while closing an open pull request or reopening a closed one when the host supports that
  action.
- Rewrite a pull request's title and description from the review itself, in Markdown, with a preview
  before saving.
- Rewrite your own comments the same way wherever they are shown.
- GitHub, GitLab, Bitbucket, and Origin support these editing tools. Azure DevOps accepts a new title
  and description, but its comments remain read-only in T3 Code; use the host website to view diffs
  or change comments.
- Bitbucket does not support reopening a declined pull request.
- On GitHub, add or remove labels from the **Labels** row. Changing labels requires triage access or
  better on the repository.

## Troubleshooting

- **Not authenticated:** run the provider's login command on the server, then rescan. For Bitbucket,
  confirm the running server received the environment variables.
- **GitHub sign-in cannot be verified:** update GitHub CLI to at least 2.81.0.
- **Push fails despite a connected account:** check the Git remote's credentials. SSH and HTTPS
  remotes can require separate setup from the hosting provider's API access.
- **A review cannot load:** open it on the host website while resolving connectivity, permissions,
  or rate limits.

### Provider tools

- [GitHub CLI](https://cli.github.com/)
- [GitLab CLI](https://gitlab.com/gitlab-org/cli)
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/)
- [Origin CLI](https://cursor.com/docs/origin/cli)
