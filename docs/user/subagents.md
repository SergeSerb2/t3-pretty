# Subagents

Provider CLIs can spawn child agents — Claude Task/Agent, Codex collaboration
threads, and Grok subagents. T3 Code does not start those children
itself. It watches them in the Agents panel, and it can tell the provider how
you want them run.

## Defaults

Open **Settings → Agents**.

- **Use subagents** is the default for every thread that has not set its own
  policy. Turn it off to stop new spawns. Children that are already running
  keep going until you stop them from the Agents panel.
- **Default child model** is per provider. Leave a provider on **Automatic**
  and T3 Code picks a cheaper sibling of the thread's model (for example Opus
  children run as Sonnet, `grok-4.6` children as `grok-build`). Pin a model
  when you want a specific child.

Changing the global default applies to every thread that still says Inherit,
including the one you are in now. It does not restart the provider session.

## This thread

In the composer, open the `⋯` menu next to the model options and choose **Agents**.

- **Inherit** follows Settings → Agents.
- **Off** blocks new spawns on this thread.
- **On** allows spawns and can pin a child model for this thread only.

The change applies from the next turn. T3 Code does not restart the session
to apply it.

## What the provider actually does

T3 Code is honest about how much it can enforce:

- **Claude:** the child model is set on the next new Claude session. This turn
  is also hinted.
- **Everyone else:** each turn is hinted. The provider can ignore the hint.

If a child still clones an expensive parent, check the Agents panel for the
model it actually ran, then pin a cheaper child or turn spawning off.

## Mobile

There is no Agents picker on mobile yet. Threads started from the phone follow
your globally enabled Settings → Agents policy.
