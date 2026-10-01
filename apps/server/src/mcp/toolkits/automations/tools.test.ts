import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import { AutomationsToolkit } from "./tools.ts";

it("registers the automation management surface with the right safety annotations", () => {
  expect(Object.keys(AutomationsToolkit.tools)).toEqual([
    "automations_list",
    "automations_get",
    "automations_create",
    "automations_update",
    "automations_delete",
    "automations_run_now",
    "automations_list_runs",
    "automations_validate_schedule",
  ]);

  for (const name of [
    "automations_list",
    "automations_get",
    "automations_list_runs",
    "automations_validate_schedule",
  ] as const) {
    const annotations = AutomationsToolkit.tools[name].annotations;
    expect(Context.get(annotations, Tool.Readonly), `${name} must be readonly`).toBe(true);
    expect(Context.get(annotations, Tool.Idempotent), `${name} must be idempotent`).toBe(true);
    expect(Context.get(annotations, Tool.Destructive), `${name} must not be destructive`).toBe(
      false,
    );
  }

  const destructive = (name: keyof typeof AutomationsToolkit.tools) =>
    Context.get(AutomationsToolkit.tools[name].annotations, Tool.Destructive);
  expect(destructive("automations_delete")).toBe(true);
  expect(destructive("automations_create")).toBe(false);
  expect(destructive("automations_update")).toBe(false);
  expect(destructive("automations_run_now")).toBe(false);
});

it("exports provider-compatible object schemas with usable descriptions", () => {
  for (const tool of Object.values(AutomationsToolkit.tools)) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
      readonly anyOf?: unknown;
      readonly oneOf?: unknown;
    };
    expect(
      tool.description?.length ?? 0,
      `${tool.name} should tell an agent when to use it`,
    ).toBeGreaterThan(40);
    // Strict MCP clients reject anything but an object at the parameter root.
    expect(schema.type, `${tool.name} must export a top-level object schema`).toBe("object");
    expect(schema.anyOf, `${tool.name} must not export a root anyOf`).toBeUndefined();
    expect(schema.oneOf, `${tool.name} must not export a root oneOf`).toBeUndefined();
    expect(Tool.getJsonSchemaFromSchema(tool.successSchema).type).toBe("object");
  }
});

it("tells the agent how to get schedules and webhook URLs right", () => {
  const create = AutomationsToolkit.tools.automations_create.description ?? "";
  expect(create).toContain("automations_validate_schedule");
  expect(create).toContain("IANA");
  expect(create).toContain("5 minutes");
  // The server only knows a path; every reachable host prefix is the user's call.
  expect(create).toContain("prefix");
});
