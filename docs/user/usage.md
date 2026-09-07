# Usage and limits

## Understand your usage

**Usage** combines Codex, Claude Code, Cursor, Grok, and Kimi session history from your connected
environments. It shows token use, cache savings, provider shares, model breakdowns, and estimated
API-equivalent cost. These estimates are not your subscription bill. Cursor does not currently
persist token usage in its local session files, so its share stays at zero until that changes.

Totals depend on the history available on each server. Grok Build totals come from persisted
session updates; interactive turns without a saved completed-turn record are missing from the
totals.

Disconnected or offline environments are left alone: opening Usage does not reconnect them, and
their totals are omitted until they are connected again.

On web and desktop, use the environment dropdown to filter costs, tokens, and limits. All
environments are selected by default. The dropdown shows which environments are still scanning;
results appear as each one responds.

If recent work is missing or a new model shows no cost, refresh to rescan session history on every
connected environment and refetch model pricing on each of them.

Use **Past 24h** for an hourly chart covering the exact rolling 24-hour period. The **7 days**,
**30 days**, and **90 days** ranges use daily resolution. Cost and token toggles update both the
headline and chart.

## Set custom model prices

On web or desktop, open the environment dropdown on **Usage**, then choose **Model prices** to add,
edit, or reset a model's estimated price. **Apply to** starts with your current Usage filter;
choose all environments or select individual destinations. Enter the exact model ID and USD
rates per million input and output tokens. You can enter any model ID, including models
without public pricing.

Cache read and cache write rates are optional and use the input rate when blank. Enter `0` for
tokens that are free. Saved prices replace automatic pricing for all of that environment's
history and are shared with clients connected to it. When environments have different prices,
cells show **Mixed**. Edit rates directly in the table, then choose **Save changes** to apply all
edited rows. Untouched cells keep each environment's rate. Select one environment to inspect its
prices. **Reset to automatic** marks a model's override for removal when you save; you can undo
it before saving.

Each destination reports whether the change saved. Offline or unavailable environments are
marked **Not saved**. Reconnect them and choose **Retry failed saves** to finish the same change
without writing again to environments that already saved. Changes are not queued after you close
the dialog.

## Track subscription limits

**Usage → Limits** shows quota use and reset times for Codex and Claude subscriptions in each
connected environment. It includes session and weekly windows, plus a per-model weekly window such
as Fable when your plan has one.

Each window is a bar from the moment it opened to its reset, filled by the share of quota spent. A
thin line marks how far into the window you are, which is also where even spending would have put
the fill. The icon beside the label says whether you are ahead of, on, or under that pace. Hover a
bar for the exact reset time.

Limits refresh on the provider health-check interval and update live while a turn runs. If a window
looks stale, refresh Limits to re-check every provider and hub.

API-key accounts have no subscription windows and say so. This includes Claude Code connections
that reach Anthropic through a proxy using `ANTHROPIC_AUTH_TOKEN`, since the CLI then treats itself
as an API-key client.

## Connect a CLIProxyAPI hub

To see pooled accounts, open **Settings → Providers → Usage providers → Add hub**. Choose the
environment that will connect to the hub and enter its URL and management key. The key is stored on
the server and never sent back to a client.

The accounts appear under **Usage → Limits**. Each limits row shows its provider and instance name;
hub accounts have a small _CLI Proxy_ label. When a connected provider reports limits for the same
provider and email, its row replaces the hub copy while retaining details such as banked reset
credits. The hub copy remains visible if the connected provider cannot report limits. Emails are
blurred until clicked, as in provider settings.

This connection supplies usage information; configure the provider separately to send agent
requests through the hub. Remove the hub from the same settings section when you no longer need it.
