# Grok Bot

Grok Bot is the always-on agent from xAI and Cursor. It runs on a persistent cloud computer tied
to your Cursor account, not on the machine running T3 Code, and it has its own weekly usage
allowance separate from Cursor's editor models. T3 Code drives it through the same connection the
Grok Bot desktop app uses, so nothing extra is installed.

## Turn It On

Grok Bot is off by default. Enable it from its card in **Settings → Providers**.

## Sign In

Grok Bot uses your Cursor account. On the machine running the T3 Code server, sign in with the
Cursor CLI:

```bash
agent login
```

T3 Code reuses that session. When the server runs somewhere the Cursor CLI is not signed in, paste
a Cursor access token into the provider's **Cursor access token** setting instead.

You need Grok Bot access on the account: any paid individual Cursor plan, a Cursor Teams seat, or a
linked SuperGrok, SuperGrok Plus, or SuperGrok Heavy subscription.

## How Threads Map To Bots

Every T3 Code thread gets its own bot, named after the thread. The bot also appears in the Grok
Bot desktop and mobile apps, and its conversation continues to live there after the thread is
closed. Reopening the thread in T3 Code re-attaches to the same bot.

When the bot is created, T3 Code tells it the project directory, the `origin` git remote, and the
current branch. The bot works on a copy of the repository on its own computer, so ask it to push a
branch or open a pull request when you want the result back. Because nothing changes locally, these
turns produce no checkpoint or diff in T3 Code.

## Approvals

Grok Bot asks before running commands on your computer and before consequential actions on its
own. In **Full access** and **Auto** modes T3 Code approves these on your behalf. In other modes
they appear as approval cards in the thread.

Commands the bot wants to run on your computer are executed by the Grok Bot desktop app. If the app
is not running when you approve one, the bot waits for it.

## What Is Supported

- bot replies streamed into the thread as they arrive
- live tool activity while the bot works on its computer
- interrupting a running turn
- Grok Bot's option prompts, answered from the thread
- resuming a thread against the same bot

Attachments are not sent yet; only the message text reaches the bot. Grok Bot has no model choice,
so the model picker shows a single entry. Grok Bot cannot generate commit messages, branch names,
or thread titles; pick another provider for those in **Settings**.
