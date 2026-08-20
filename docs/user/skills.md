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

Claude Code, Codex, Cursor, and Grok also keep skills in their own home folders
(for example `~/.claude/skills` or `~/.codex/skills`), plus a shared `~/.agents/skills`
directory. Those show up under **On this environment**. Flip a skill off to hide it from
the provider CLI without deleting it. **Remove** deletes that folder on the connected
environment — the same list whether you are on this machine or a remote connection.

Plugin, system, and project-local skills the CLIs report stay under **Also detected**. Those
are owned by a plugin or a repo, so T3 Code leaves them alone.

## Turn skills on

- **Everywhere:** flip a skill's switch in **Settings → Skills → Installed**. Globally enabled
  skills apply to every thread in the environment, on any provider. Provider CLI skills under
  **On this environment** have the same switch: on means the CLI can load them, off hides them
  without deleting the folder.
- **Per thread:** in the composer, open the `⋯` menu next to the model options and choose
  **Skills**, or type `/skills`. Search the list, and star skills you use often to pin them
  at the top. The rest stay grouped by where each skill lives (**Library** and every provider
  CLI's home folder). Long names stay on one line instead of stretching the menu sideways.
  Rows with a **Global** badge are already on — library skills enabled in settings, and
  skills the selected provider loads from its own home — and can only be turned off there.
  Everything else toggles per thread, including a skill from another provider's folder or
  one you turned off in settings. Thread picks stack on top of the global set and apply
  from the next turn.

Grok and Codex can generate images (Grok Imagine, Codex imagegen). When an agent creates an
image, T3 Code shows it in the thread as it finishes.

When a turn starts with skills attached (from Settings, the thread picker, or a `$skill` mention
in the prompt), T3 Code sends each skill's instructions along with your message, so the agent
has them without having to look them up. The thread log shows a **Skill** row for each one, the
same way it shows a tool call. A skill is sent once per thread — later turns reuse what is already
in the conversation — and sent again if you switch the thread to a different provider. If the
agent loads a skill on its own, that shows up as another Skill row.

`$skill` mentions work for the provider's own skills (the ones the `$` picker lists) and for
skills already in the workspace. A mention that matches nothing is left as plain text.

## What lands in your project

When a turn starts, T3 Code copies the enabled skills into the thread's workspace under
`.claude/skills/` and `.agents/skills/`, the locations provider CLIs scan. Only folders T3 Code
created are touched — your own skill folders are never modified or removed. Each copy carries its
own `.gitignore`, so it never shows up in `git status` or in the agent's commits. In worktree mode
the copies stay inside the thread's worktree; in local mode they are refreshed at each turn start.

Per-thread picks from a provider CLI's home folder are copied the same way, so a skill that
lives in `~/.codex/skills` can be turned on for a Claude thread and vice versa.

On mobile there is no skills picker yet; threads started from mobile get your globally enabled
skills automatically.
