# Source Control Integrations

T3 Code connects to your Git hosting provider so you can create pull requests, review code, and manage repositories without leaving the app.

## Supported Providers

T3 Code works with the platforms your team already uses:

- **GitHub** – Pull requests, repository creation, and clone integration
- **GitLab** – Merge requests, repository publishing, and hosted clones
- **Bitbucket** – Pull request workflows (via API token authentication)
- **Azure DevOps** – Pull request support for Microsoft-hosted repositories
- **Origin** – Cursor's git forge at origin.cursor.com (pull requests, clone, and publish)

## What You Can Do

### Start Projects from Anywhere

**Clone repositories directly**

- Open the Command Palette (`Cmd/Ctrl + K`) → **Add Project**
- Choose **GitHub repository**, **GitLab repository**, **Bitbucket repository**, **Azure DevOps repository**, **Origin repository**, or paste any **Git URL**
- Enter the repository path (`owner/repo`, `group/project`, `workspace/repository`, or `project/repository`) or a full Git URL, pick a destination, and start coding

**Publish local projects to the cloud**

- Have a local Git repository without a remote?
- Use the **Publish Repository** action to create a new hosted repository (GitHub, GitLab, Bitbucket, Azure DevOps, or Origin), add it as your origin remote, and push, in one flow
- If the local repository has no commits yet, publishing creates the remote and wires it up but does not push. Make a commit, then push normally.

### Manage Code Reviews Without Context Switching

**Create pull requests while you work**

- Push a branch and create a pull request from the Git actions controls in the toolbar
- T3 Code can suggest titles and descriptions based on your commits
- Supports GitHub Pull Requests, GitLab Merge Requests, Bitbucket Pull Requests, Azure DevOps Pull Requests, and Origin Pull Requests

**Stay on top of open reviews**

- See if your current branch already has an open PR/MR
- For open GitHub PRs, open the git menu beside the PR action to see Codex Auto Review's public
  state: running, complete, feedback, an earlier result, or no public signal
- Open several reviews from the **Pull requests** page as tabs in the right panel
- List filters stay where you left them when you come back. **Reset filters** in the filter
  menu returns the list to open pull requests across every project. On iPhone and iPad the
  list is always one server, so clear also returns to your preferred server
- On iPhone and iPad, open **Pull Requests** from the home header or sidebar to browse, review,
  merge, comment, and resolve conflicts in the app. A thread's git controls and pull request
  links in the conversation open the same native manager instead of the host in the browser
- While working in a thread, open linked reviews in the same compact right-panel tabs without
  leaving the conversation. Origin pull requests at `cursor.com/codebase` open there the same
  way GitHub pull requests do
- On Origin pull requests, Grok auto-review summary cards stay hidden so the conversation shows
  findings and discussion. Use **Show auto-review summaries** when you want the write-ups
- **Fix all** on an open pull request starts a thread that works through every unresolved review
  finding — GitHub, GitLab, Bitbucket, Azure DevOps, Origin, and Grok Origin comments — then
  resolves the conversations it fixed. You pick the agent and reasoning effort first. Per-comment
  **Fix in a thread** buttons still handle one finding at a time. The action stays hidden until
  the pull request has unresolved review comments
- **Fix continuously** starts the same focused sweep, then keeps the agent watching latest-commit
  reviews and checks, fixing new actionable feedback until the pull request is green. It appears
  with **Fix all**, only when those comments are present
- On GitHub pull requests, see emoji reactions on the description and comments — including Codex's
  eyes while it reviews and thumbs-up when it finishes without comments
- Resolved review conversations collapse in the pull request conversation and on the diff, so you
  can see which comments are done without opening GitHub. Hide them entirely with **Hide resolved**
- Open the review directly in your browser with one click
- Command-click (Control-click on Windows and Linux) a pull request number in the sidebar to open it in your browser instead of in T3 Code
- Check out a teammate's branch to review code locally

When a PR/MR closes without merging, its thread settles automatically across clients. A merged PR stays in the active list until you settle it. Pinned threads and threads you explicitly kept active remain in the active list.

The Codex indicator is based on activity GitHub exposes publicly: the connector's eyes reaction while
reviewing, thumbs-up when it finishes without comments, or a posted Codex review when it finds
issues. **No public signal** is intentionally not labeled as “skipped”: it can also mean Smart Review
is still deciding or Auto Review is disabled. Codex's current Smart Review setting remains the source
of truth for that configuration.

**Fix what you wrote, in place**

- Rewrite a pull request's title and description from the review itself, in Markdown, with a
  preview before you save
- Rewrite your own comments the same way, wherever they are shown
- Works on GitHub, GitLab, Bitbucket, and Origin. Azure DevOps takes a new title and description; its
  comments stay read-only here, as they already were

### Know Your Setup at a Glance

The **Source Control settings** page shows you exactly what's connected:

- ✅ Which providers are authenticated and ready
- ⚠️ What's missing and how to fix it
- 👤 Which account is signed in (when available)

Run a quick **Rescan** after setting up a new machine or changing credentials.

## Getting Started

### For GitHub (Recommended for most users)

1. Install the GitHub CLI (version 2.81.0 or newer) on the machine running T3 Code:
   ```bash
   brew install gh
   ```
2. Sign in:
   ```bash
   gh auth login
   ```
3. Open **Settings → Source Control** in T3 Code and verify GitHub shows as authenticated

You can now clone, publish, and create pull requests.

### For GitLab

1. Install the GitLab CLI:
   ```bash
   brew install glab
   ```
2. Authenticate:
   ```bash
   glab auth login
   ```
3. Check **Settings → Source Control** to confirm the connection

### For Bitbucket

Bitbucket uses tokens instead of a CLI tool. Two options, both set as environment variables on the
machine running T3 Code.

Recommended, a Bitbucket access token:

```bash
export T3CODE_BITBUCKET_ACCESS_TOKEN="your-access-token"
```

Or an Atlassian account email plus API token, with read/write access to pull requests and
repositories, plus read access to your user account (`read:user:bitbucket`, used to verify the
connection):

```bash
export T3CODE_BITBUCKET_EMAIL="you@example.com"
export T3CODE_BITBUCKET_API_TOKEN="your-token"
```

If both are set, the access token wins. Restart T3 Code and verify the connection in **Source
Control settings**.

### For Origin

1. Install the Origin CLI on the machine running T3 Code:
   ```bash
   curl -fsSL https://downloads.cursor.com/origin/install.sh | sh
   ```
   Add `~/.local/bin` to your `PATH` if the shell cannot find `origin`.
2. Sign in:
   ```bash
   origin auth login
   ```
3. Check **Settings → Source Control** to confirm the connection

Origin remotes look like `https://origin.cursor.com/owner/repo.git`. Pull requests open at `cursor.com/codebase`.

### For Azure DevOps

1. Install Azure CLI:
   ```bash
   brew install azure-cli
   ```
2. Add the DevOps extension:
   ```bash
   az extension add --name azure-devops
   ```
3. Sign in:
   ```bash
   az login
   ```

---

## Requirements & Troubleshooting

**Git is required** – T3 Code uses Git for all local operations. Ensure `git` is installed on your server.

**Server-side setup** – Authentication happens on the machine running T3 Code (the server), not your local browser. If you're using a hosted or team instance, your administrator may have already configured providers.

**Common issues:**

- **Provider shows "Not authenticated"** – Run the login command for that provider (e.g., `gh auth login`) in a terminal on the server, then rescan in Settings
- **GitHub says it could not verify sign-in status** – T3 Code needs GitHub CLI 2.81.0 or newer to check sign-in status. Update `gh` (e.g., `brew upgrade gh`), then rescan
- **Bitbucket not connecting** – Double-check your environment variables are set in the correct shell profile and the server was restarted
- **Can't push to a remote** – Verify your Git remote URL matches the provider you've authenticated with (SSH vs HTTPS remotes may need different credentials)

**Need more help?** Check your provider's CLI documentation:

- [GitHub CLI](https://cli.github.com/)
- [GitLab CLI](https://gitlab.com/gitlab-org/cli)
- [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/)
- [Origin CLI](https://cursor.com/docs/origin/cli)
