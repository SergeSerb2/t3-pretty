# First-run setup

T3 Pretty walks you through setup the first time you open a new installation
or connect to the hosted app. Setup is a short climb with four stops: Base
camp, Ridge, Saddle, and Summit. Existing workspaces skip it. To run setup
again, open `/welcome`.

Stops with nothing to do are passed automatically. If every computer already
has a signed-in agent, setup goes straight from Base camp to the Saddle. If no
earlier projects are found, it goes straight to the Summit. Select a passed
stop on the ridge line at the bottom of the window to go back to it.
**Skip setup** leaves at any point once a computer is connected.

## Base camp: connect your computers

Base camp checks the computers this app already knows. It shows whether each
one is connected, which agents are ready, and how many projects your Claude
Code and Codex history holds. If you opened T3 Pretty from the desktop app or
a server, that computer is already connected. It is listed by its own name,
which may differ from the device running your browser.

Open **Bring another computer** to add more:

- **T3 Connect** connects computers that are signed in to your account.
  [Install the CLI](./install.md#command-line) and run `t3 connect` on each
  computer you want to add, then start T3 Pretty or run `t3 serve` so the
  computer stays available.
- **Pair with a link** connects directly to a server on your network or
  tailnet. Start the server with `t3 serve`, then run `t3 pair --tailscale`
  and paste the pairing link. You can also run `t3 serve --host <address>` and
  use `t3 pair` when the server is already reachable on your network.

Every computer is set up unless you uncheck it, and unchecking does not
disconnect it. Continue once your selected computers are connected.

If T3 Pretty cannot confirm the workspace during startup, it shows **Still
connecting** instead of opening the app. Select **Reload** to try again.

If T3 Pretty cannot read your saved settings, it shows **Could not read
settings**. Select **Retry** after storage becomes available. Setup does not
replace unreadable settings with defaults.

## Ridge: set up your agents

T3 Pretty checks each selected computer for Claude Code and Codex. If an agent is
not installed or signed in, select its action to open a terminal with the
correct command ready to run. Install uses the vendor's own installer, which
keeps **Update now** working in Settings. Other providers can be enabled in
Settings.

The setup terminal uses the home directory and environment configured for the
selected provider instance. Sensitive values remain redacted in Settings and
terminal metadata while the terminal process can use them.

## Saddle: import your projects

T3 Pretty finds directories that Claude Code or Codex has used. Git repositories
are listed first, newest activity on top. When the remote is on GitHub, the
group shows the repository as `owner/name`. Clones with the same remote share
one group. Directories that are not git repositories sit under "Other folders".

The default selection includes git repositories active within the last 30 days
with at least three conversations. Use the checkboxes, or "Select all" and
"Select none", to change the selection. Linked git worktrees, Codex scratch
directories under `Documents/Codex`, and anything under `Downloads` are not
offered.

A large or malformed history can reach the scan limit. T3 Pretty keeps the
projects it found and warns when projects or conversations may be missing.

Imported projects include Codex and Claude conversations active within the last
30 days. You can continue those conversations in T3 Pretty.

Conversation import is best effort. T3 Pretty keeps the first user prompt and the
newest remaining visible user and assistant messages, with 200 messages total.
It omits tool activity and attachments. For Codex, it omits generated setup
context only when a canonical user event and a valid shared turn ID identify the
same user turn. Ambiguous legacy or response-only context stays in the imported
conversation so T3 Pretty does not remove user text. It reads one conversation at
a time and skips files larger than 16 MiB. It ignores malformed records and skips
unreadable or unparseable conversations.

Each import attempt reads up to 100 conversation files and 64 MiB per project,
with up to 100,000 input records. Run import again to continue a large batch.
Completed conversations are not imported again. You can continue without the
remaining history.

## Summit

The Summit shows what was imported and warns if some history could not be
imported. Select **Start the first thread** to open a new thread in your
imported project, or **Open T3 Pretty** if you imported nothing.

## Mobile

The first time the mobile app opens with no computer paired, it runs a short
version of the same climb: pair a computer by scanning its pairing code or
signing in to T3 Connect, allow notifications, and you are done. Setup moves on
by itself as soon as the computer connects. To see it again, open
**Settings → Replay welcome**.
