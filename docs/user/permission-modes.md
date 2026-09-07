# Permission modes

Permission modes control when an agent needs your approval to act. Choose a mode in the message
composer; it applies to that thread.

The mode is set per thread, from the mode control in the message composer. Changing it in one
thread does not change any other thread. New threads start in **Full access** (**Yolo** on Kimi)
unless you choose another mode before sending. A thread created from another thread inherits its
mode.

| Mode                  | Behavior                                                                              |
| --------------------- | ------------------------------------------------------------------------------------- |
| **Supervised**        | Requests approval for commands and file changes.                                      |
| **Auto-accept edits** | Approves file edits automatically; other actions can still require approval.          |
| **Auto**              | Uses the provider's automatic review to approve routine actions and ask about others. |
| **Full access**       | Allows commands and edits without approval prompts.                                   |

Approve or reject requests in the conversation to let the agent continue. Permission modes do
not prevent the agent from asking questions about the task.

## Provider differences

Providers enforce permissions differently. Some read-only actions can proceed in **Supervised**.
**Auto**: routine actions proceed without you; risky ones still ask. Codex delegates routine
approvals to an AI reviewer, Claude uses its own auto permission mode, and Cursor uses Smart Auto
review. Providers without an equivalent, such as Antigravity, fall back to asking, like
Supervised.

**Full access**: allow commands and edits without prompts. The default. The agent runs
unattended until it finishes or asks a question of its own.

Kimi offers **Supervised**, **Yolo**, and **Full access** — the generic Auto and Auto-accept
edits modes are not offered for Kimi. Both unattended modes run with full access; they differ in
whether Kimi can stop to ask you questions: **Yolo** can (and is the default for Kimi), while
**Full access** never does.

For Grok, **Always allow this session** remembers the matching command or tool input. Other
actions still require approval.

Mobile offers the same modes with the same labels and descriptions: the four generic modes above,
or **Supervised**, **Yolo**, and **Full access** for Kimi threads.

Antigravity can still send native approval requests in **Full access**. It only offers remembered
approvals for actions that support them.

Antigravity's native `/plan` command requests a plan. It does not change the permission mode.
T3 Pretty's separate Plan mode control is not available for Antigravity. See
[Antigravity](./providers-antigravity.md) for setup and thread limits. See the
[provider guides](./install.md#providers) for setup and provider-specific limits.
