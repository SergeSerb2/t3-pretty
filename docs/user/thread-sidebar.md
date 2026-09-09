# Working with threads

Use a new thread for a separate task. Choose **New worktree** when its code changes
need a separate branch and working directory.

## Start a thread

On web and desktop, a new thread keeps the current project and carries your model
and mode selections, unless the destination project has its own model default.
Its branch and workspace mode come from your configured defaults. To continue in
an existing worktree, use **New thread in this worktree** from the branch toolbar.

When you change a new thread's project, T3 Code stays in the current environment
if that project exists there. Otherwise it selects an environment that has it.
The same repository on several machines is one project. Two clones of it on one
machine stay separate projects, so a new thread always lands in the folder you pick.

### Start in the background

In a desktop browser or the desktop app, press `Cmd+Enter` on macOS or `Ctrl+Enter`
on Windows and Linux to start a new thread and immediately open another draft. The
next draft keeps the workspace mode and base branch you selected. With **New
worktree**, each background submission creates its own worktree.

## Pin and reorder threads

Pin a thread from its menu to keep it above your active work.

To require confirmation before unpinning, enable **Settings → General → Unpin confirmation**. The
confirmation applies to the sidebar controls, thread menus, and the `mod+shift+p` shortcut.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the T3 Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

Pinning does not prevent automatic settlement. Pinned threads still move to **Settled** when they
become inactive or when their pull request merges if **Auto-settle merged threads** is enabled.
Settling a thread removes its pin.

On web and desktop, drag a thread between sections to change its state. Drag a thread up into
the pinned section to pin it at the spot you drop it; drag a pinned thread down into the active
list to unpin it. Dragging a thread onto the **Settled** header settles it, and dragging a settled
thread into the active list un-settles it. A snoozed thread can be dragged out of the snoozed
shelf, which wakes it, but threads cannot be dragged into the shelf because snoozing needs a wake
time. Dragging a pinned thread out of the pinned section does not ask for unpin confirmation.
Pinned and active boundary labels appear only while dragging, without moving the rows. The
other rows slide aside to show where the thread will land. When you cross into another section,
the dragged thread shows the action the drop performs, with its icon: **Pin**, **Unpin**,
**Settle**, **Un-settle**, or **Wake**. Its status and hover actions hide during the drag. A pinned
thread keeps its pin only while it stays in the pinned section; once it leaves, the badge takes
over. Reordering within the same section shows no badge. When there are no pins, drag to the top
edge to pin a thread. Section labels stay readable for the whole drag, and the section the
thread is over takes the accent color. Section labels also
identify empty sections and a collapsed settled shelf.

Drag within the pinned or active section to change its order. Other rows slide aside to show the
spot where the thread will land. Drops into either section keep the position you choose. On
mobile, open a pinned or active thread's menu and choose **Move up** or **Move down**. The server
saves the order, so it survives a refresh and appears on your other connected devices.

On web and desktop, the list also animates section changes made with thread actions such as
**Pin**, **Settle**, and **Snooze**. These transitions respect your system's reduced-motion
preference. While dragging, rows follow the insertion gap without replaying a second transition
after the drop.

New threads appear above the active threads you have arranged. Settling clears a thread's active
position, so using **Un-settle** returns it to the top. Pinning and snoozing preserve its active
position until you move it again. Thread activity does not change the order. The settled shelf
continues to use settlement time.

If dragging is unavailable for one environment, update the T3 Code server running in that
environment. Pinned and active reordering require server support. Threads from older servers keep
their default order until the server is updated.

## Settle finished work

Choose **Settle thread** from its menu to move finished work out of the active list
without deleting the conversation. **Un-settle thread** restores it to active work
and prevents automatic settlement until new activity resumes the usual rules.
Manually settling an idle thread dismisses unanswered async questions without
sending an answer or restarting the agent.

Each server stores its own copy of the automatic settlement settings and checks them even when no
web, desktop, or mobile client is connected. By default, it settles threads after three days without
activity and when their pull request merges. An eligible idle thread also settles when its pull
request closes. An open pull request does not block inactivity settlement. Active work, pending
input, and live background work keep the thread active. T3 Code settles from a closed or merged
pull request only when its timestamp is not older than the user's latest activity. If that timestamp
is not available, the inactivity rule still applies. A manual un-settle also keeps the thread active.

Change these rules in **Settings → General**. The change is written to every connected environment
whose server supports shared settings. An environment that is offline or needs a server update
keeps its old value and does not appear in mismatch warnings. When a connected environment whose
server supports shared settings holds a different value, **Settings → General** shows a warning
that names it. Choose **Apply to all** to write your current values to the environments named in
the warning. The same applies to the new-thread workspace mode and the source control writing
style.

A settings change affects future settlement and does not reopen a settled thread. Settings saved
by older clients on one device no longer control this behavior.

**Settled** lists threads by when their work finished, newest first. A thread you settle yourself
sorts by the moment you settled it. A thread that settled on its own sorts by its last message or
turn, not by when the server noticed it was inactive.

When you un-settle a thread, it returns to the top of the active list so you can find it right
away. Its timestamps do not change. Other threads keep their positions.

## Drafts

A thread whose composer holds unsent text or attachments shows an amber tint and a pen icon in the
sidebar, the same marks a new-thread draft uses. On web and desktop, hover the row and choose the
**X** to discard that draft without opening the thread.

## Link a pull request

The server finds the PR for each unsettled thread's saved branch, even when your
apps are closed. Settled threads keep their saved links. Update the server if
automatic branch links do not appear.

On web and desktop, right-click a pull request link in a thread and choose
**Link to thread** to select a different PR. Use **Unlink from thread** on the
same link to return to the branch PR, if one exists.
The linked pull request participates in automatic settlement.

## Find and reference work

On web and desktop, open the command palette with `Cmd/Ctrl+K` to search threads
across connected environments. Message search starts after two characters and
includes your messages and final agent responses.

Use **Settings → Keybindings** to find or customize shortcuts for searching files
and copying a thread reference. A copied reference uses the thread's pull request
link when available, otherwise its thread ID. See [keybindings](./keybindings.md)
for custom configuration.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While T3 Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.

## Inspect agent work

On web and desktop, use **Agents** to follow work delegated to subagents.

Expand a tool call in the conversation to see its full command and output.
Summaries shorten shell wrappers and can still describe the latest call after it
finishes; the call's own result shows its status.

## World Scenery

On phone, [World Scenery](./world-scenery.md) draws the Home list as frosted cards and plates over
the landscape photo. Solid rows return if Boring is on, scenery is off, or iOS Reduce Transparency
is on.

## The Automations shelf

Projects with [automations](./automations.md) get an **Automations** shelf above the pinned section,
listing each automation with its status and either the time until its next run or **Paused**. Expand
a row to see its last few runs, or open the automation for its full history. Every automation run
works in its own thread, and those run threads live inside the automation rather than in your thread
list, so a nightly job cannot bury your own work; a run that fails or needs an answer still counts
toward the inbox and the Dock badge.

## Clearing settled threads

The **Settled** section header has a **Clear** action that archives every settled thread at once,
after a confirmation. The thread you currently have open is left in the list. Archiving removes
threads from the sidebar without deleting anything; they remain in each project's archived list,
and the toast offers **Undo**.

To keep the settled list from growing forever, enable **Auto-archive settled threads** in Settings
under General. Threads that have been settled longer than the number of days you choose are
archived automatically. The thread you currently have open is never archived out from under you.

## Dock badge on macOS

The desktop app's Dock icon shows how many inbox threads are waiting on you — an agent blocked on
an approval or a question, or a finished turn you have not opened yet. Settled and snoozed threads
do not count; they are parked, not a request. When that number grows while T3 Code is in the
background, the icon bounces once; clearing the backlog clears the badge. It never bounces while
you are already in the app.

## Panel motion

The main sidebar, right panel, and terminal drawer open and close immediately by default. Under
**Settings → Appearance → Motion**, move the **Panel animations** slider above 0 ms to add motion.
The duration can be set up to 400 ms. Clicking the preview replays all three panel transitions; at
0 ms, it snaps between the same open and closed states.

## Environment icons

When you are connected to more than one environment, every thread that lives somewhere other than
the machine you are on wears a small icon for that machine at the end of its row: a server, a cloud
VM, a desktop, a laptop, a Mac mini, or a Mac Studio. In the hosted web app and the mobile app,
where every environment is remote, each row wears its machine so you can tell them apart at a
glance. The same icon appears wherever an environment is named: the thread tooltip, the command
palette, the "Run on" picker, the pull request server filter, the provider settings device tabs,
and the environment lists under **Settings → Connections**. On mobile it appears in the thread
lists, the archive, the new-task environment picker, and the Environments and storage settings.

Servers pick the icon themselves from the hardware they run on. A Mac reports its model, a Linux
machine reports its chassis type and whether it is a virtual machine, and anything without a usable
signal shows a generic server. To override it, open **Settings → Connections** and choose an icon
for that environment; **Automatic** goes back to what the server detected. The choice is stored on
that server, so every device that connects to it sees the same icon.

## Environment artwork

Dev environments can identify themselves with artwork at the top of the sidebar and in the send
button, or with a version pill. Nightly builds keep the sidebar as glass, with no night-sky header.
In Settings under environment identification, choose **Artwork**, **Version pill**, or **None**.
Artwork is recolored to match World Scenery.

## Offline and mobile actions

You can settle, un-settle, snooze, or wake a thread even when its machine is offline. The list
updates immediately on this device. When that environment is reachable again — including through
T3 Connect — T3 Code applies the same change there.

On mobile, the thread screen's top bar is Settle, Snooze, and Pull request. Settle and snooze are
the same actions as the list swipe: settle moves the thread into Settled, snooze hides it until a
time you pick, and an already settled or snoozed thread offers Un-settle or Wake. Pull request
opens the branch's open PR, or starts create / commit-and-PR when the branch is ready. Review
changes, files, and other git actions live in that control's menu.
