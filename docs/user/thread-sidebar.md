# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
Pinned threads are shown independently of their project, including when you connect to more than
one environment.

Pinned threads still move to **Settled** when they become inactive. They also move when their pull
request merges if **Auto-settle merged threads** is enabled.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the T3 Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.
On phone, [World Scenery](./world-scenery.md) draws the Home list as frosted cards and plates over
the landscape photo. Solid rows return if Boring is on, scenery is off, or iOS Reduce Transparency
is on.

## Dock badge on macOS

The desktop app's Dock icon shows how many inbox threads are waiting on you — an agent blocked on
an approval or a question, or a finished turn you have not opened yet. Settled and snoozed threads
do not count; they are parked, not a request. When that number grows while T3 Code is in the
background, the icon bounces once; clearing the backlog clears the badge. It never bounces while
you are already in the app.

## Environment artwork

Dev environments can identify themselves with artwork at the top of the sidebar and in the send
button, or with a version pill. Nightly builds keep the sidebar as glass, with no night-sky header.
In Settings under environment identification, choose **Artwork**, **Version pill**, or **None**.
Artwork is recolored to match World Scenery.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While T3 Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.

You can settle, un-settle, snooze, or wake a thread even when its machine is offline. The list
updates immediately on this device. When that environment is reachable again — including through
T3 Connect — T3 Code applies the same change there.

On mobile, the thread screen's top bar is Settle, Snooze, and Pull request. Settle and snooze are
the same actions as the list swipe: settle moves the thread into Settled, snooze hides it until a
time you pick, and an already settled or snoozed thread offers Un-settle or Wake. Pull request
opens the branch's open PR, or starts create / commit-and-PR when the branch is ready. Review
changes, files, and other git actions live in that control's menu.
