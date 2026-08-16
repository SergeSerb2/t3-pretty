# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

## Slash commands

Type `/` at the start of a line to open the command menu. Keep typing to filter; **Enter** or
**Tab** runs the highlighted entry.

**Built-in** commands run inside T3 Code and never send text to the agent:

| Command | What it does |
| --- | --- |
| `/model` | Open the model picker for this thread. |
| `/plan`, `/default` | Switch between plan mode and build mode (when plan mode is on). |
| `/supervised`, `/auto`, `/full-access`, `/auto-accept-edits` | Change the permission mode. The provider's own names appear where they differ (Kimi shows `/yolo`). |
| `/skills` | Open the skills picker for this thread. |
| `/auto-pr` | Toggle opening a pull request when the thread finishes (where available). |
| `/new` | Start a new thread. |
| `/commands` | Open the command palette. |
| `/settings` | Open settings. |

**Provider** commands are the ones the selected agent reports — custom commands, plugin
commands, and the like. Picking one inserts it into the message and the agent runs it when
you send.

## Linking files and skills

Type `@` to link a workspace file or folder, or a skill the selected agent knows about. The
menu splits into **Files** and **Skills**; a skill is inserted as a `$skill` mention, so `$`
still works as a skills-only shortcut.
