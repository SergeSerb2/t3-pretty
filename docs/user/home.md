# Home

Opening T3 Pretty with nothing selected, clicking the T3 Pretty mark in the top left, or running
**Go to home** from the command palette lands you on a fresh draft in your most recent project:
the "What should we build in …?" page with the composer. Above the composer, suggested prompts
for the day sit in a horizontal row.

## Suggestions

Once a day T3 Pretty reads your projects and their recent threads, then an agent plans what to do
next and writes it up as cards:

- **Project cards** continue work in a specific project: the natural next step after what an
  agent just built, something a thread left broken, missing tests, or debt the threads exposed.
- **New idea** cards are ideas outside your current work: a tool worth building, an experiment,
  or a fresh project. They start in whichever project the draft is open for; switch projects from
  the headline first if you want them elsewhere.

Click a card and its prompt is typed into the composer. Nothing is sent until you press send, so
edit it first if you like. A card for another project opens a draft there instead. Dismiss a card
with the **×** in its corner; it stays gone until the next batch.

When a batch has both project cards and new ideas, switch between them with the labels above the
row. The row scrolls sideways; the arrows beside the labels bring the next cards into view.

The batch regenerates at **09:00** in the environment's local time. If the machine was asleep at
that moment, the batch runs once when it is back. The refresh icon beside the row, or
**Generate now** in Settings, makes a new batch right away.

Machines linked to the same Surge Connect account share one batch. At the daily time, the first
linked machine to reach it generates cards from the projects on every linked machine. The others
pick up that same batch within about ten minutes, so the mesh spends one generation a day instead
of one per machine. A card for a project on another machine opens a draft on that machine. It is
hidden on clients that are not connected to that machine. Dismissing a card removes it
everywhere. If another machine is already generating, **Generate now** says so and waits for its
batch. A machine that is not linked, or cannot reach Surge Connect, generates its own cards.

## Settings

**Settings → General → Home suggestions**:

- **Daily home suggestions** turns the schedule off or on. Off also hides the row.
- **Home suggestions model** is the model that plans the cards. It reads a digest of every recent
  thread at once, so it defaults to GPT-6 Astra at low reasoning rather than the cheaper model used
  for thread titles. Any text generation provider works here.
- **Home suggestions time** is the local time of the daily run.
- **Generate now** makes a new batch for the selected environment, shared with its linked machines.

Suggestions are generated with the provider subscription of the machine that runs the batch. For
a linked mesh, that is whichever machine claims the day's slot, using its own model setting. To
share the batch, linked machines send Surge Connect a short summary of their recent threads: project
names, thread titles, and the first request and final reply of each, clipped. The mobile app does
not show suggestions yet.
