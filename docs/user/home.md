# Home

Opening T3 Pretty with nothing selected, clicking the T3 Pretty mark in the top left, or running
**Go to home** from the command palette lands you on a fresh draft in your most recent project:
the "What should we build in …?" page with the composer. Above the composer, suggested prompts
for the day sit in horizontal rows.

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

Project cards and new ideas are separate rows when a batch has both. Each row scrolls sideways.
The last visible card is cut off, and the arrow at the edge of the row brings the next cards
into view.

The batch regenerates at **09:00** in the environment's local time. If the machine was asleep at
that moment, the batch runs once when it is back. The refresh icon beside the row, or
**Generate now** in Settings, makes a new batch right away. Each environment generates its own
cards; the row shows the ones for the environment the draft belongs to.

## Settings

**Settings → General → Home suggestions**:

- **Daily home suggestions** turns the schedule off or on. Off also hides the row.
- **Home suggestions model** is the model that plans the cards. It reads a digest of every recent
  thread at once, so it defaults to GPT-6 Astra at low reasoning rather than the cheaper model used
  for thread titles. Any text generation provider works here.
- **Home suggestions time** is the local time of the daily run.
- **Generate now** makes a new batch for the selected environment.

Suggestions are generated on the environment that hosts your projects, using that machine's
provider subscription. The mobile app does not show them yet.
