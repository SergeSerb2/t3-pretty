# Kimi

T3 Code connects to Kimi Code through its Agent Client Protocol (ACP) server. Install Kimi on the
machine running the T3 Code server, then authenticate it:

```bash
kimi --version
kimi login
```

The default provider uses the normal Kimi data directory at `~/.kimi-code`. T3 Code discovers
the models, thinking levels, and approval modes advertised by the installed CLI rather than
assuming a fixed catalog.

## Multiple Accounts Or Configurations

Kimi supports relocating all of its data with `KIMI_CODE_HOME`. Add another Kimi provider in
T3 Code Settings and set **KIMI_CODE_HOME path** to a different directory:

```text
Kimi Work      KIMI_CODE_HOME path: ~/.kimi-code-work
Kimi Personal  KIMI_CODE_HOME path: ~/.kimi-code-personal
```

Authenticate each home independently:

```bash
KIMI_CODE_HOME=~/.kimi-code-work kimi login
KIMI_CODE_HOME=~/.kimi-code-personal kimi login
```

T3 Code treats providers with different Kimi homes as separate continuation environments, so a
thread never silently resumes against another account's session store.

## What Is Supported

- streamed assistant output and tool activity
- image attachments
- MCP servers forwarded over ACP
- Kimi's Manual, Plan, Auto, and YOLO approval modes
- session resume, cancellation, model selection, and thinking-level selection
- Kimi-backed commit messages, branch names, thread titles, and change request text

For upstream CLI details, see the official
[Kimi ACP reference](https://www.kimi.com/code/docs/en/kimi-code-cli/reference/kimi-acp.html) and
[data locations](https://www.kimi.com/code/docs/en/kimi-code-cli/configuration/data-locations.html).
