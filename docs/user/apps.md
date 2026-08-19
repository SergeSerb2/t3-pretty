# Apps

Apps connect your agents to the services you already use — Gmail, Google Calendar, GitHub,
Linear, Notion, Slack, Sentry, Figma, and more — so you can type `@gmail clean up my inbox`
or `@github summarize the open PRs` and the agent does it with that service's own tools.

Each app is a remote MCP server (Streamable HTTP). T3 Code connects to it once, keeps the
credential on the environment that runs your agents, and hands every provider (Codex, Claude,
Cursor, Grok, Kimi, OpenCode) the same set of apps. Nothing runs on your machine for an app;
there is no background process to keep alive.

## Connect an app

Open **Settings → Apps**.

- **Browse apps** lists the built-in catalog. Pick one and press **Add**.
  - Most apps sign in with OAuth: a browser window opens, you approve, and the app shows
    **Connected** when you come back.
  - Some accept an **API token** instead (GitHub personal access tokens, Zapier, Stripe keys):
    paste it into the dialog.
  - Docs servers such as Context7, DeepWiki, Hugging Face or Microsoft Learn need no sign-in.
- **Add custom MCP server** connects any Streamable HTTP MCP server by URL, with OAuth,
  a token, or no sign-in. Servers that only speak the legacy SSE transport are not supported.

Every connected app gets an `@name` — the handle you use in chat and the name providers show
the MCP server under. You can rename it from **Edit**.

### Apps that need your own OAuth client

Google (Gmail, Calendar, Drive, Docs, Sheets, Slides, Chat, Contacts), GitHub OAuth, Slack,
HubSpot, Box, Render, MongoDB Atlas and PagerDuty do not let T3 Code register itself as an
OAuth client. Create one in the provider's console and paste its Client ID and secret under
**Settings → Apps → OAuth clients** before you press **Connect**. The dialog shows the exact
redirect URI to register and the steps for that provider. One Google client covers every
Google app.

The redirect URI is derived from the address you reach your environment at
(for example `http://127.0.0.1:3773/api/apps/oauth/callback`). If you also connect from a
phone or a T3 Connect tunnel, register that origin's callback URI too.

## Use an app in a thread

Type `@` in the composer and pick the app from the **Apps** group, or just write `@gmail`.
The mention is a hint; every app that is switched on is available to the agent in every
thread on that environment, mentioned or not. Turn an app off in **Settings → Apps** to pull
its tools out of new sessions, or remove it to forget it entirely.

## Check, disconnect, remove

- **Test** opens a live connection and lists the tools the app exposes — the quickest way
  to confirm a credential still works.
- **Disconnect** revokes the stored credential and keeps the app in the list so you can
  reconnect later; **Remove** forgets it.
- An app that stops working shows the last error on its row (usually an expired or revoked
  token). **Reconnect** fixes it.

## Where credentials live

Tokens stay on the environment that runs your agents, in the server's secret store next to
the other server secrets. Providers never see them: each session talks to your apps through
the environment's own MCP proxy with the short-lived credential it already holds.
