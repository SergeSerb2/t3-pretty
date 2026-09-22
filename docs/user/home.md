# Home

The home screen is what you see when nothing is open: click the T3 Pretty mark in the top left,
run **Go to home** from the command palette, or open the app fresh. It shows the threads you
touched last and a set of suggested prompts for the day.

## Suggestions

Once a day T3 Pretty reads your projects and their recent threads and proposes prompt cards:

- **Keep going** cards continue work in a specific project: the natural next step after what an
  agent just built, something a thread left broken, missing tests, or debt the threads exposed.
- **Something new** cards are ideas outside your current work: a tool worth building, an
  experiment, or a fresh project. Pick the project they should start in with the **Start in**
  chooser; the prompt tells the agent where to create files.

**Start** opens a new thread in that project with the prompt already typed. Nothing is sent until
you press send, so edit it first if you like. Dismiss a card with the **×** in its corner; it stays
gone until the next batch.

The batch regenerates at **09:00** in the environment's local time. If the machine was asleep at
that moment, the batch runs once when it is back. **Refresh** on the home screen, or **Generate
now** in Settings, makes a new batch right away. Each environment generates its own cards; when
several are connected they appear one after another.

## Settings

**Settings → General → Home suggestions**:

- **Daily home suggestions** turns the schedule off or on. Cards already on the screen stay until
  the next batch.
- **Home suggestions model** is the model that plans the cards. It reads a digest of every recent
  thread at once, so it defaults to GPT-6 Astra at low reasoning rather than the cheaper model used
  for thread titles. Any text generation provider works here.
- **Home suggestions time** is the local time of the daily run.
- **Generate now** makes a new batch for the selected environment.

Suggestions are generated on the environment that hosts your projects, using that machine's
provider subscription. The mobile app does not show them yet.
