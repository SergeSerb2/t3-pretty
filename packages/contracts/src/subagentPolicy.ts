/**
 * Subagent policy — whether a thread may spawn provider-native children,
 * and which model those children should use.
 *
 * T3 does not spawn subagents. It observes Claude Task/Agent, Codex
 * collaboration threads, and other provider-native children. This module is
 * the control plane: a global default, a per-thread override, and a resolver
 * that adapters apply through the strongest hook they actually have.
 *
 * @module subagentPolicy
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";
import { ProviderOptionSelections, type ProviderOptionSelection } from "./model.ts";
import { ProviderDriverKind, ProviderInstanceId } from "./providerInstance.ts";

export const SubagentPolicyMode = Schema.Literals(["inherit", "off", "on"]);
export type SubagentPolicyMode = typeof SubagentPolicyMode.Type;

export const SubagentChildSelection = Schema.Struct({
  model: TrimmedNonEmptyString,
  options: Schema.optional(ProviderOptionSelections),
});
export type SubagentChildSelection = typeof SubagentChildSelection.Type;

export const ThreadSubagentPolicy = Schema.Struct({
  mode: SubagentPolicyMode,
  // Used only when mode is `on`. Null/absent means "use the global or sibling
  // default child" while still pinning the thread on.
  child: Schema.optional(Schema.NullOr(SubagentChildSelection)),
});
export type ThreadSubagentPolicy = typeof ThreadSubagentPolicy.Type;

export const DEFAULT_THREAD_SUBAGENT_POLICY: ThreadSubagentPolicy = {
  mode: "inherit",
};

/** Global default inside `ServerSettings`. */
export const SubagentPolicySettings = Schema.Struct({
  // Inherit threads follow this. Default on so existing fleets keep spawning,
  // but children no longer silently inherit the parent model.
  enabled: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(true))),
  // Per-instance child pin. Missing instance → cheaper sibling of the parent.
  children: Schema.Record(ProviderInstanceId, SubagentChildSelection).pipe(
    Schema.withDecodingDefault(Effect.succeed({})),
  ),
});
export type SubagentPolicySettings = typeof SubagentPolicySettings.Type;

export const DEFAULT_SUBAGENT_POLICY_SETTINGS: SubagentPolicySettings = {
  enabled: true,
  children: {},
};

export const SubagentPolicyBind = Schema.Literals(["session-env", "hint"]);
export type SubagentPolicyBind = typeof SubagentPolicyBind.Type;

export const SubagentChildSource = Schema.Literals(["thread", "global", "sibling"]);
export type SubagentChildSource = typeof SubagentChildSource.Type;

export const SubagentPolicySource = Schema.Literals(["thread", "global"]);
export type SubagentPolicySource = typeof SubagentPolicySource.Type;

export const ResolvedSubagentPolicy = Schema.Struct({
  enabled: Schema.Boolean,
  source: SubagentPolicySource,
  child: Schema.NullOr(SubagentChildSelection),
  childSource: Schema.NullOr(SubagentChildSource),
  bind: SubagentPolicyBind,
  parentModel: TrimmedNonEmptyString,
});
export type ResolvedSubagentPolicy = typeof ResolvedSubagentPolicy.Type;

const CLAUDE_DRIVER = ProviderDriverKind.make("claudeAgent");
const CODEX_DRIVER = ProviderDriverKind.make("codex");
const CURSOR_DRIVER = ProviderDriverKind.make("cursor");
const GROK_DRIVER = ProviderDriverKind.make("grok");
const KIMI_DRIVER = ProviderDriverKind.make("kimi");

export const CLAUDE_SUBAGENT_MODEL_ENV = "CLAUDE_CODE_SUBAGENT_MODEL";

export function threadSubagentPolicyOrInherit(
  policy: ThreadSubagentPolicy | null | undefined,
): ThreadSubagentPolicy {
  return policy ?? DEFAULT_THREAD_SUBAGENT_POLICY;
}

export function subagentPolicyBindForDriver(driver: ProviderDriverKind): SubagentPolicyBind {
  return driver === CLAUDE_DRIVER ? "session-env" : "hint";
}

export function defaultSubagentChildOptions(
  driver: ProviderDriverKind,
): ReadonlyArray<ProviderOptionSelection> {
  if (driver === CLAUDE_DRIVER || driver === KIMI_DRIVER) {
    return [{ id: "effort", value: "low" }];
  }
  return [{ id: "reasoningEffort", value: "low" }];
}

/**
 * Cheaper sibling of the parent model. Prefers a same-family rename so
 * OpenRouter-style slugs (`anthropic/claude-opus-4.6`) stay valid.
 */
export function deriveCheaperSiblingModel(driver: ProviderDriverKind, parentModel: string): string {
  const model = parentModel.trim();
  if (model.length === 0) {
    return model;
  }

  if (/opus/i.test(model)) {
    return model.replace(/opus/gi, "sonnet");
  }
  if (/sonnet/i.test(model)) {
    return model.replace(/sonnet/gi, "haiku");
  }

  if (driver === GROK_DRIVER) {
    if (/grok-4/i.test(model) || /grok-3/i.test(model)) {
      return "grok-build";
    }
    return model;
  }

  if (driver === CODEX_DRIVER) {
    if (/sol|terra/i.test(model)) {
      return "gpt-5.6-luna";
    }
    return model;
  }

  if (driver === CURSOR_DRIVER && (model === "default" || /composer-1|gpt-5|opus/i.test(model))) {
    return "composer-2";
  }

  return model;
}

export function deriveCheaperSibling(
  driver: ProviderDriverKind,
  parentModel: string,
): SubagentChildSelection {
  return {
    model: deriveCheaperSiblingModel(driver, parentModel),
    options: [...defaultSubagentChildOptions(driver)],
  };
}

export function resolveSubagentPolicy(input: {
  readonly global?: SubagentPolicySettings | null;
  readonly thread?: ThreadSubagentPolicy | null;
  readonly parentModel: string;
  readonly parentInstanceId: ProviderInstanceId;
  readonly driver: ProviderDriverKind;
}): ResolvedSubagentPolicy {
  const global = input.global ?? DEFAULT_SUBAGENT_POLICY_SETTINGS;
  const thread = threadSubagentPolicyOrInherit(input.thread);
  const bind = subagentPolicyBindForDriver(input.driver);
  const parentModel = input.parentModel.trim();

  if (thread.mode === "off") {
    return {
      enabled: false,
      source: "thread",
      child: null,
      childSource: null,
      bind,
      parentModel,
    };
  }

  const enabled = thread.mode === "on" ? true : global.enabled;
  const source: SubagentPolicySource = thread.mode === "on" ? "thread" : "global";

  if (!enabled) {
    return {
      enabled: false,
      source,
      child: null,
      childSource: null,
      bind,
      parentModel,
    };
  }

  if (thread.mode === "on" && thread.child != null) {
    return {
      enabled: true,
      source: "thread",
      child: thread.child,
      childSource: "thread",
      bind,
      parentModel,
    };
  }

  const globalChild = global.children[input.parentInstanceId];
  if (globalChild !== undefined) {
    return {
      enabled: true,
      source,
      child: globalChild,
      childSource: "global",
      bind,
      parentModel,
    };
  }

  return {
    enabled: true,
    source,
    child: deriveCheaperSibling(input.driver, parentModel),
    childSource: "sibling",
    bind,
    parentModel,
  };
}

function formatChildOptions(child: SubagentChildSelection): string {
  const options = child.options ?? [];
  if (options.length === 0) {
    return "";
  }
  const parts = options.flatMap((option) => {
    if (typeof option.value === "boolean") {
      return option.value ? [option.id] : [];
    }
    return [`${option.id}=${option.value}`];
  });
  return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

export function renderSubagentPolicyInstructions(
  policy: ResolvedSubagentPolicy,
): string | undefined {
  if (!policy.enabled) {
    return `<t3_subagent_policy>
Do not spawn subagents, background agents, Task/Agent tools, or collaboration children. Do the work in this thread. If a tool would launch a child agent, do not call it.
</t3_subagent_policy>`;
  }

  const child = policy.child;
  if (child == null || child.model.length === 0) {
    return undefined;
  }

  return `<t3_subagent_policy>
When you spawn a subagent, Task, or collaboration child, you MUST use model ${child.model}${formatChildOptions(child)}. Do not inherit this thread's model (${policy.parentModel}). If the spawn tool accepts a model or effort argument, set it explicitly.
</t3_subagent_policy>`;
}

export function subagentPolicyBindCaption(bind: SubagentPolicyBind): string {
  return bind === "session-env"
    ? "Claude applies the child model on the next new session. This turn is also hinted."
    : "Hinted each turn. The provider can ignore this.";
}
