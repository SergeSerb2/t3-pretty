# Skills

Skills are packaged agent playbooks: a folder with a `SKILL.md` that the agent loads when the
topic comes up. Every provider CLI keeps its own skills folder in your home directory
(`~/.claude/skills`, `~/.cursor/skills`, `~/.grok/skills`, and so on), and Codex and Cursor also
read the shared `~/.agents/skills` folder. T3 Code treats all of those as one library and shows
every skill once, wherever it lives.

## See what you have

Open **Settings → Skills**. Each row is one skill folder on the connected environment, with a chip
per provider:

- A filled chip means that provider can see the skill.
- A dimmed chip means it cannot. Click it to turn the skill on for that provider.
- A locked chip means the provider reads the skill straight from the folder it lives in, so there
  is nothing to toggle.

Turning a skill on for a provider puts a link to the skill's folder in that provider's skills
directory, the same way the `npx skills` installer does. Turning it off removes the link. Nothing
inside the skill's folder changes, and skills you installed with other tools work the same way.

**Remove** deletes the skill's folder from the environment, along with its links. Skills shipped by
plugins or checked into a repository are not listed here; they belong to the plugin or the repo.

## Install skills

The **Find skills** section browses skill repositories on GitHub and installs with one click. It
ships with [mattpocock/skills](https://github.com/mattpocock/skills) as a source; **Add repository**
accepts any `owner/repo` that contains skills. Installs land in `~/.agents/skills` and are turned on
for every provider right away. A repository skill whose name you already have shows **In library**.

## Attach skills to a thread

Providers only learn a skill's name and description from disk; the instructions reach the agent
when the skill is invoked. To make sure a skill's instructions apply in a thread, attach it:

- In the composer, open the `⋯` menu next to the model options and choose **Skills**, or type
  `/skills`. Search the list and flip on the skills you want. Star the ones you use often to pin
  them at the top.
- Or mention it in the message with `$skill-name`. The `$` picker lists the skills the selected
  provider can see.

Attached skills are sent along with your first message, and again if you switch the thread to a
different provider. The thread log shows a **Skill** row for each one, the same way it shows a tool
call. If the agent loads a skill on its own, that shows up as another Skill row.

On mobile, the new-task view has the same picker: tap **Skills** above the composer. From a skill's
`⋯` menu you can also remove it from that machine.

## What happens on disk

T3 Code never copies skills into your project. Provider CLIs discover skills from their own folders
in your home directory, and from `.claude/skills` or `.agents/skills` inside a repository if you keep
skills there. If you ran an earlier version of T3 Code, its private skill store is moved into
`~/.agents/skills` the first time the new version starts, and the skill copies it left inside your
projects are cleaned up the next time a thread runs there.

Grok and Codex can generate images (Grok Imagine, Codex imagegen). When an agent creates an image,
T3 Code shows it in the thread as it finishes.
