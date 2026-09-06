# Messages and context

Give the agent a task in the composer. Add files, quote a previous response, or
include a skill when the task needs more context.

Messages can contain up to 120,000 characters. Longer drafts stay in the composer
so you can shorten them or split them into several messages.

## Attach files

Attach up to eight files per message. Images can be up to 10 MB; other files can
be up to 50 MB, subject to the environment's upload support and limit. The agent
receives them on the environment's machine.

Uploads begin when you add an attachment. All uploads must finish before the
message can send. Retry or remove a failed upload. On web and desktop, reloading
before an upload finishes requires you to attach that file again.

You can drag or paste images into the web or desktop composer. HEIC and HEIF
photos are converted to JPEG there and when selected from the iOS photo library;
the image limit applies after conversion. On mobile, you can also send files to
T3 Code through another app's system share sheet.

See [images and videos](#images-and-videos-in-messages) for previewing and saving media.

## Queue messages offline on mobile

Mobile keeps local copies of draft attachments, so you can preview them and queue
messages while disconnected. Uploads resume when you reconnect. Drafts and queued
messages survive app restarts. Signing out of T3 Connect keeps that work on your
device until you sign back into the same account.

## Custom models

On web and desktop, use Settings → Providers → **Models** to add an unlisted model with a custom
name and options. Only options supported by the provider integration affect turns. Antigravity
uses its account catalog and does not support custom models.

## Model defaults

T3 Code remembers your provider, model, and model options for new threads. A
project's configured model takes precedence; resetting that project setting
returns to the remembered selection.

Leaving reasoning level or service tier unset uses the provider's own configuration.

## Quote an assistant response

On web and desktop, select text within one assistant response and choose
**Cite in composer**. You can add a comment about the quote and write instructions
around it.

Select the quote in a draft or sent message to return to its source. If the source
is unavailable or has changed, the saved quote remains readable.

Mobile displays saved quotes and comments, but does not create citations or
navigate to their sources.

## Activity indicators

Loading, syncing, and server-update icons are static. Live tool labels carry a soft moving highlight while the agent works; it is disabled when your system prefers reduced motion.

## Prompt stash

On web and desktop, press `Cmd+S` on macOS or `Ctrl+S` on Windows and Linux to save
the current prompt and its attachments for later. Wait for uploads to finish first.
With an empty composer, the same shortcut restores a single stash or opens the
stash menu when there are several.

Stashes containing uploaded files must be restored in their original environment.
Those files are retained for 24 hours. After an upload expires, restore the prompt
and use **Attach again** or remove the missing file before sending.

## Voice input on iPhone

On supported iPhones with iOS 26 or later, use the composer's microphone to record,
then confirm to transcribe. Text is inserted where your selection was when
recording started, ready for you to review and edit before sending.

The first use may download Apple's speech model and needs a network connection.
Later transcription works offline for that language. Recordings can be up to five
minutes long. Canceling, leaving the screen, or an audio interruption discards the
recording and preserves your existing draft.

Transcription runs on your device. T3 Code deletes the temporary audio after
transcription or cancellation; only the message text is sent when you submit.

## Hosted voice features

Outside the native iPhone transcription described above, builds and connected environments that
offer hosted voice input can use the composer's microphone to dictate a message. Settled final agent
responses on supported builds also show a play button beside the copy button; select it to read the
complete response aloud, and select it again to stop.

Hosted dictation and read-aloud processing run through the external Groq account configured on the
connected host. Audio and response text travel through that host, and provider credentials are never
sent to the client.

## Commands and skills

Type `/` for commands or `$` to add a skill from the selected environment and
provider. On mobile, both are also available before starting a thread on
**New task**.

The slash menu also includes skills unless you turn off **Settings → General →
Show skills in slash menu**. Only skills enabled for the provider are listed.

Provider commands must start the message to run. T3 Code commands such as
`/model` and `/plan`, and skill mentions, work on any line.

Send `/compact` in an existing conversation to reduce context usage when the
provider supports it. Web and desktop also offer compaction from the context meter.

## Images and videos in messages

Select an image or video attachment or link to preview it. Playback support depends
on your browser or device; save an unsupported video to open it in another app.

On web and desktop, right-click media to save it or copy its path or URL. On mobile,
touch and hold an image or video thumbnail and choose **Save or share**. On iOS,
return to the thumbnail to open this menu after watching a full-screen video.

File links refer to the environment's machine, including when you connect remotely.
Previews use the original file, even outside the workspace. Moving or deleting it
can break the preview, so save a copy if you need to keep it.

## Files outside the workspace

Follow an agent's file link to read a report or other file outside the workspace.
These files open read-only. An HTML file outside the workspace cannot load scripts,
styles, or images from neighboring files.

## HTML and PDF files in the file viewer

On web and desktop, HTML and PDF files open as rendered pages. Switch an HTML
file to source view to read its markup; a link to a specific line opens source
automatically. HTML previews cannot access your T3 Code session.

On mobile, select a PDF attachment or link to open it. iOS uses the native viewer;
Android opens the system chooser.

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

To continue a session that began in a provider's native CLI, create a new T3 Code thread with the
same provider and send `/resume <native-session-id>` as its first command. Use the session ID shown
by the native CLI's history or resume picker. T3 Code reconnects to the provider's stored context;
it does not copy the earlier messages into the T3 Code timeline. Send your next message normally
after the resume completes.

The configured provider must use the same native data directory or account that owns the session.
The command is available for Claude, Codex, Cursor, Grok, and Kimi providers that are installed and
ready.

## Linking files and skills

Type `@` to link a workspace file or folder, or an app. Skills live behind `$`: type `$` to
pick a skill the selected agent knows about, and it is inserted as a `$skill` mention.
