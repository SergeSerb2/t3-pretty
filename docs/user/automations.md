# Automations

An automation is a saved prompt that T3 Code runs for you on its own — on a schedule, when
something happens, or when you press **Run now**. Each run opens its own thread in the project, the
agent works exactly as it would if you had typed the prompt, and the result waits for you in the
**Automations** shelf.

Automations belong to a project and run on the environment that hosts it. That machine has to be
awake and running its T3 Code server; nothing runs in the cloud on your behalf.

## Create an automation with an agent

The quickest way is to let an agent write it.

1. Open a project's settings and choose **New automation**, or run **New automation** from the
   command palette.
2. T3 Code starts a new thread with the prompt already typed in the composer, asking the agent to
   set up an automation for this project. Edit it if you like, then send it.
3. Tell the agent what the automation should do and when. It can check a schedule for you and show
   the next few run times before anything is saved.
4. The agent shows you a summary and creates the automation only when you agree. It cannot start a
   run unless you ask.

Once a project has an automation, the sidebar grows an **Automations** shelf; while a single project
is in scope its header carries a **+**, the fastest way to add the next one.

The agent has tools for listing, reading, creating, updating, deleting and running automations, so
"pause the nightly dependency check" or "move it to 6am" works as a plain sentence in any thread of
that project. An automation can never create or trigger another automation from inside its own run.

## Create one yourself

Open a project's settings — the command palette's **Automations** action goes straight there —
and choose **Create manually**, or **Edit** on an existing automation, to get the form: name, the
prompt to run, triggers, model, permission mode, workspace, and a timeout. **Advanced** holds the
last-run summary, catch-up and minimum-interval options. The form is on web and desktop only.

## Triggers

An automation can carry up to eight triggers, of any mix. Every trigger requests the same run.

### Schedule

Pick a preset — **Every hour**, **Daily at 09:00**, **Weekdays at 09:00**,
**Weekly on Monday at 09:00** — or choose **Custom** and write a five-field cron expression. A
timezone is required so that "09:00" means the same thing wherever the server is; it defaults to
your device's timezone. The editor shows the next three run times as you type, and the automation
page shows the next one.

Schedules must be at least five minutes apart. A per-minute cron is rejected with an explanation
rather than saved.

### Run now

**Run now** is on the automation row's context menu, the automation page, and the mobile detail
screen. It works even while the automation is paused. It is unavailable while a run is already in
progress.

### In-app events

- **Turn completed** fires when any thread in this project finishes a turn.
- **Turn failed** fires when a turn in this project ends in an error.
- **Pull request merged in T3** fires only for merges you perform inside T3 Code. A merge done on
  GitHub, from the command line, or by another tool is invisible to it — use a webhook for those.

All three only listen to the automation's own project; another project's threads never trigger it.

Runs started by an automation never fire these events, so an automation cannot re-trigger itself.

### Webhook

Add a webhook trigger and T3 Code mints a URL for that automation, shown on its page with a copy
button. Paste it into GitHub's repository webhooks, Zapier, a CI job, or anything else that can
send an HTTP POST. The body is passed to the agent as the run's payload.

The sender has to be able to reach your server. If the URL starts with `localhost` or `127.0.0.1`,
T3 Code says so: only this machine can call it. Expose the server through Tailscale or T3 Connect
and use that hostname instead. See [Remote access](./remote-access.md).

- GitHub's `ping` delivery is answered but never starts a run, so the green check in GitHub's UI
  does not cost you a run.
- One delivery is accepted per automation every five seconds; anything faster is rejected.
- A paused automation, or an environment with automations paused, rejects deliveries.
- The token in the URL is a password. **Rotate token** on the automation page mints a new URL and
  makes the old one dead — do that whenever the URL has been pasted into a third-party UI you no
  longer trust, or shared in a screenshot.

### Git remote changes

Pick a branch (or leave it on the project's default branch) and T3 Code fetches the remote in the
project's checkout every few minutes and starts a run when the branch's commit changes. The first
check only records where the branch is; it does not run.

Because this is polling from your machine, pushes that land while the server is off are never seen:
when the server comes back it records the new commit as the baseline and waits for the next push.
Change how often it checks with **Settings → General → Automation git poll interval**.

Event, webhook and git triggers share a **Minimum interval** (one minute by default). A second
trigger inside that window is ignored. A trigger that arrives while a run is in progress is
remembered and starts one run when the current one finishes — a burst of pushes produces one
follow-up run, not ten.

## Where runs live

Automations get their own **Automations** shelf in the sidebar, above the pinned threads, listing
the automations of the projects you have in scope. Each row shows a status dot, the name, and
either the time until the next run or **Paused**. Expand a row for its last five runs; failures are
tinted so you can spot them without opening anything.

Click the name to open the automation's page: its configuration, next and last run, a
consecutive-failure count, and the full run history grouped by day. Long stretches of successful
runs collapse into a single "N more runs" row that you can expand; failed and interrupted runs are
never collapsed. Click a run to open its thread.

Run threads are deliberately kept out of the normal thread list, so a nightly automation cannot
bury your own work. They are reachable from the automation, and only from there. A run that needs
your approval or your answer, and a run that failed, still raise the inbox count and the Dock
badge.

T3 Code keeps the threads of the 25 most recent runs of each automation and deletes older ones,
along with their worktrees. The run row stays in the history with its status and summary; it says
**Thread removed** instead of opening a conversation.

## Inside a run thread

A run thread carries a banner naming the automation and what triggered it, with a link back to the
automation. The prompt you see is the prompt you wrote. T3 Code appends a short hidden block that
tells the agent it is running unattended: don't ask questions unless truly blocked, make reasonable
assumptions and say so, and finish with a short plain-language summary. That summary is what the
run row shows.

Turn on **Include last run summary** and each run also receives the previous run's summary, so an
automation can pick up where it left off.

You can type in a run thread like any other. Doing so does not change the automation.

## Pause and resume

**Pause** on an automation stops its schedule, events, webhook deliveries, and git polling.
**Run now** still works while it is paused, which makes pausing the safe way to stop a noisy
automation without losing it. Pausing never interrupts a run that is already going; **Resume** puts
it back on its schedule.

To stop every automation on one machine — a laptop you are travelling with, say — use **Settings →
General → Pause automations on this environment**. Scheduled, event, webhook and git triggers all
stop for that environment, its automation pages on web and desktop show a banner saying so, and
**Run now** still works. Agents can still read and edit automations while the environment is paused.
Mobile shows no banner for it yet; the automations of a paused environment simply stop running
there.

## Missed runs

If the server is asleep or shut down when a schedule comes due, T3 Code catches up once when it
comes back: one run for the whole missed window, no matter how long it was. That is what
**Catch up missed runs** does, and it is on by default.

Turn it off and the missed instant is recorded in the history as a **missed** run instead, and the
automation simply waits for its next scheduled time.

A scheduled run that comes due while the previous run is still going is recorded as **skipped**
with the reason, rather than piling two runs onto the same checkout.

## Where a run works

- **Permission mode** is per automation and works like a thread's. Unattended runs default to full
  access, because nobody is there to approve anything; drop it if the automation should not be
  able to act freely. An agent editing an automation can never give it more access than the thread
  it is editing from.
- **Workspace** is the project checkout by default: the run works in the same directory you do.
  Choose **New worktree per run** and each run gets its own isolated branch and directory, which is
  what you want for anything that writes code. Worktree runs turn on **Create a pull request** by
  default, so the work lands as a PR instead of sitting on a branch nobody opens.
- **Timeout** ends a run that has gone quiet or is stuck, two hours by default and up to 24 hours.
  A timed-out run is marked interrupted and its turn is stopped.

A run that fails counts up the automation's consecutive-failure number, shown on its page; a
successful run resets it.

## Mobile

The mobile app can see and control automations, but not write them. Open **Automations** from the
Home header (or the sidebar toolbar on iPad) for the list, filtered by environment and project. A
detail screen gives you the configuration, the run history, **Run now**, and the Pause/Resume
switch, and opens a run's thread when it still exists.

There is no automation editor on mobile yet. Create and edit them on web or desktop, or ask an
agent to do it — that works from the phone.

Automations appear only for environments whose server supports them. If a machine's automations
never show up, update the T3 Code server running there.

## Limits

- Up to eight triggers per automation; scheduled runs at least five minutes apart.
- One run at a time per automation.
- The threads of the 25 most recent runs are kept; older run threads are deleted.
- Webhook bodies larger than 256 KB are rejected, and the payload handed to the agent is truncated.
- Deleting an automation deletes its run threads and stops any run in progress. Deleting a project
  deletes its automations.
