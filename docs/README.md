# T3 Code docs

## Using T3 Code

- [Install T3 Code](./user/install.md)
- [Messages and context](./user/composer.md)
- [Working with threads](./user/thread-sidebar.md)
- [Permission modes](./user/permission-modes.md)
- [Terminal history](./user/terminal.md)
- [Source control](./user/source-control.md)
- [Project settings](./user/project-settings.md)
- [Appearance and themes](./user/appearance.md)
- [Keyboard shortcuts](./user/keybindings.md)
- [Skills](./user/skills.md)
- [Apps](./user/apps.md)
- [Subagents](./user/subagents.md)
- [World Scenery](./user/world-scenery.md)
- [Import browser sessions](./user/browser-import.md)
- [Usage and limits](./user/usage.md)
- [Storage](./user/storage.md)
- [Product usage data](./user/telemetry.md)
- [Mobile appearance](./user/mobile-appearance.md)
- [Environment themes](./user/environment-theme.md)
- [Remote access](./user/remote-access.md)
- [T3 Connect mesh](./user/remote-access.md#t3-connect)
- [Move a thread between environments](./user/remote-access.md#move-a-thread-to-another-environment)
- [Running in the background](./user/background-service.md)
- [Updating T3 Code](./user/updating.md)
- [Automatic pull requests](./user/auto-pull-requests.md)
- [Automations](./user/automations.md)
- Provider guides: [Codex](./user/providers-codex.md) · [Claude](./user/providers-claude.md) · [OpenCode](./user/providers-opencode.md) · [Antigravity](./user/providers-antigravity.md)

Mobile app: [apps/mobile/README.md](../apps/mobile/README.md)

---

## Working on T3 Code

Start with the [development runbook](./operations/development.md) and
[contribution policy](../CONTRIBUTING.md).

Internal notes preserve architectural decisions, constraints, and implementation traps that the
source alone does not explain. Most code changes do not need an internal documentation update. Follow the
[documentation rules](../AGENTS.md#documentation) before adding one.

- [Architecture overview](./internals/overview.md)
- [Glossary](./internals/glossary.md)
- [Connection runtime](./internals/connection-runtime.md)
- [Providers](./internals/providers.md)
- [Apps (remote MCP connections)](./internals/apps.md)
- [Automations](./internals/automations.md)
- [Model classification](./internals/model-manifest.md)
- [Remote environments](./internals/remote.md)
- [Server updates](./internals/server-updates.md)
- [Resource telemetry](./internals/resource-telemetry.md)
- [Product analytics](./internals/product-analytics.md)
- [Environment auth](./internals/environment-auth.md)
- [T3 Connect](./internals/t3-connect.md)
- [Assistant citations](./internals/assistant-citations.md)
- [Mobile navigation](./internals/mobile-navigation.md)
- [Mobile development lifecycle](./internals/mobile-development.md)
- [Terminal runtime](./internals/terminal-runtime.md)
- [Voice input](./internals/voice-input.md)

### Performance audits

- [macOS architecture and performance deep dive (2026-08-15)](./internals/t3-pretty-macos-architecture-performance-deep-dive-2026-08-15.md)
- [macOS and iOS performance audit (2026-08-12)](./internals/t3-pretty-macos-ios-performance-audit-2026-08-12.md)
- [CPU performance audit (2026-08-11)](./internals/t3-pretty-performance-audit.md)

### Brainstorms

- [Feature brainstorm, ranked top ten (2026-08-22)](./internals/t3-pretty-feature-brainstorm-2026-08-22.md)
- [World Scenery dark↔light transition (2026-08-21)](./internals/theme-transition-brainstorm-2026-08-21.md)

### Runbooks

- [Development and local builds](./operations/development.md)
- [T3 Connect setup](./operations/connect-setup.md)
- [Release](./operations/release.md)
- [Observability](./operations/observability.md)
- [Relay observability](./operations/relay-observability.md)
- [Mobile app store screenshots](./operations/mobile-app-store-screenshots.md)
