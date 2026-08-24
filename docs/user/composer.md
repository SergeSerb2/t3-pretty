# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

## Commands and skills

Type `/` to open the command menu. Type `$` to find and add a skill. Skill rows show their source,
such as System, Personal, Project, or App.

By default, the `/` menu includes skills. To keep this menu command-only, turn off **Show skills in
slash menu** in **Settings → General**. Skill results use the `/skill:Skill Name` label and add the
same `$name` skill token to your message. The original skill name remains searchable. If the provider
also reports that skill as a native slash command, T3 Code hides the duplicate native entry and keeps
the `/skill:Skill Name` label.

On desktop, press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to
start it in the background. T3 Code opens another new thread and shows an **Open** action for the
thread that started. The new thread keeps the selected workspace mode and base branch. If **New
worktree** is selected, each background thread creates its own worktree.

## Sending while the agent is working

While a turn is running, the composer keeps a send button next to stop, and every provider
behaves the same way:

- **Send now** (the send button, or **Enter** on desktop) steers the running turn: the message
  is delivered into the work in progress as soon as the agent can accept it.
- **Queue for next turn** (the menu next to the send button, or **Option+Enter** /
  **Alt+Enter**) holds the message until the current turn finishes, then starts a new turn
  with it. Queued messages are held by the server, so they still send if you close the app
  or disconnect; restarting the server clears the queue. Several queued messages start one
  turn each, in order.

On mobile, tap send to steer, or long-press it to queue.

## Slash commands

Type `/` at the start of a line to open the command menu. Keep typing to filter; **Enter** or
**Tab** runs the highlighted entry.

**Built-in** commands run inside T3 Code and never send text to the agent:

| Command                                                      | What it does                                                                                        |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `/model`                                                     | Open the model picker for this thread.                                                              |
| `/plan`, `/default`                                          | Switch between plan mode and build mode (when plan mode is on).                                     |
| `/supervised`, `/auto`, `/full-access`, `/auto-accept-edits` | Change the permission mode. The provider's own names appear where they differ (Kimi shows `/yolo`). |
| `/skills`                                                    | Open the skills list in the composer `⋯` menu.                                                      |
| `/auto-pr`                                                   | Toggle opening a pull request when the thread finishes (where available).                           |
| `/new`                                                       | Start a new thread.                                                                                 |
| `/commands`                                                  | Open the command palette.                                                                           |
| `/settings`                                                  | Open settings.                                                                                      |

**Provider** commands are the ones the selected agent reports — custom commands, plugin
commands, and the like. Picking one inserts it into the message and the agent runs it when
you send.

## Linking files and skills

Type `@` to link a workspace file or folder, or a skill the selected agent knows about. The
menu splits into **Files** and **Skills**; a skill is inserted as a `$skill` mention, so `$`
still works as a skills-only shortcut.
