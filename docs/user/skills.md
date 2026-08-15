# Skills

Skills are packaged agent playbooks — a folder with a `SKILL.md` the agent loads when the
topic comes up. T3 Code keeps its own skill library per environment, so the skills you install
follow you across providers instead of living in one CLI's config directory.

## Install skills

Open **Settings → Skills**. The **Marketplace** section browses skill repositories and installs
with one click. It ships with [mattpocock/skills](https://github.com/mattpocock/skills) as a
source; **Add repository** accepts any GitHub `owner/repo` that contains skills.

The **Installed** section lists everything in your library. **Uninstall** removes a skill from
the library (and from every thread that had it on).

## Clean up provider CLI skills

Claude Code, Codex, Cursor, Grok, and OpenCode also keep skills in their own home folders
(for example `~/.claude/skills` or `~/.codex/skills`), plus a shared `~/.agents/skills`
directory. Those show up under **On this environment**. **Remove** deletes that folder on the
connected environment — the same list whether you are on this machine or a remote connection.

Plugin, system, and project-local skills the CLIs report stay under **Also detected**. Those
are owned by a plugin or a repo, so T3 Code leaves them alone.

## Turn skills on

- **Everywhere:** flip a skill's switch in **Settings → Skills → Installed**. Globally enabled
  skills apply to every thread in the environment, on any provider.
- **Per thread:** in the composer, open **Skills** (next to the model options) and search or
  toggle skills for that thread. Global skills show a **Global** badge and stay on; thread picks
  stack on top of them. You can change a thread's picks any time — they apply from the next turn.

## What lands in your project

When a turn starts, T3 Code copies the enabled skills into the thread's workspace under
`.claude/skills/` and `.agents/skills/`, the locations provider CLIs scan. Only folders T3 Code
created are touched — your own skill folders are never modified or removed. In worktree mode the
copies stay inside the thread's worktree; in local mode they are refreshed at each turn start.

On mobile there is no skills picker yet; threads started from mobile get your globally enabled
skills automatically.
