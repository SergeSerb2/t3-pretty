import { expect, it } from "@effect/vitest";
import * as Context from "effect/Context";
import { Tool } from "effect/unstable/ai";

import { CanvasToolkit } from "./tools.ts";

const schemaHasDescription = (schema: unknown): boolean => {
  if (!schema || typeof schema !== "object") return false;
  const record = schema as Record<string, unknown>;
  if (typeof record.description === "string" && record.description.length > 0) return true;
  return [record.anyOf, record.oneOf, record.allOf]
    .filter(Array.isArray)
    .some((members) => members.some(schemaHasDescription));
};

it("exports provider-compatible object schemas with described parameters", () => {
  const tools = Object.values(CanvasToolkit.tools);
  expect(tools.map((tool) => tool.name).sort()).toEqual([
    "canvas_add_image",
    "canvas_add_node",
    "canvas_get_state",
    "canvas_remove_node",
    "canvas_update_node",
  ]);
  for (const tool of tools) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
      readonly properties?: Readonly<Record<string, unknown>>;
      readonly anyOf?: unknown;
      readonly oneOf?: unknown;
    };
    expect(
      tool.description?.length ?? 0,
      `${tool.name} should have a useful description`,
    ).toBeGreaterThan(40);
    expect(schema.type, `${tool.name} must export a top-level object schema`).toBe("object");
    expect(schema.anyOf, `${tool.name} must not export a root anyOf`).toBeUndefined();
    expect(schema.oneOf, `${tool.name} must not export a root oneOf`).toBeUndefined();
    for (const [field, fieldSchema] of Object.entries(schema.properties ?? {})) {
      expect(
        schemaHasDescription(fieldSchema),
        `${tool.name}.${field} should explain what data the agent must pass`,
      ).toBe(true);
    }
  }
});

it("tells the agent how to read images and interpret selection in canvas_get_state", () => {
  const description = CanvasToolkit.tools.canvas_get_state.description ?? "";
  expect(description).toContain("filePath");
  expect(description).toContain("Read tool");
  expect(description).toContain("selectedNodeIds");
  expect(description).toContain("z-order");
});

it("annotates every canvas tool as closed-world with accurate effect hints", () => {
  const annotationsByName = Object.fromEntries(
    Object.values(CanvasToolkit.tools).map((tool) => [
      tool.name,
      {
        readonly: Context.get(tool.annotations, Tool.Readonly),
        destructive: Context.get(tool.annotations, Tool.Destructive),
        idempotent: Context.get(tool.annotations, Tool.Idempotent),
        openWorld: Context.get(tool.annotations, Tool.OpenWorld),
      },
    ]),
  );
  for (const [name, annotations] of Object.entries(annotationsByName)) {
    expect(annotations.openWorld, `${name} only touches the thread canvas`).toBe(false);
  }
  expect(annotationsByName.canvas_get_state).toMatchObject({
    readonly: true,
    destructive: false,
    idempotent: true,
  });
  expect(annotationsByName.canvas_add_image).toMatchObject({
    readonly: false,
    destructive: false,
    idempotent: false,
  });
  expect(annotationsByName.canvas_add_node).toMatchObject({
    readonly: false,
    destructive: false,
    idempotent: false,
  });
  expect(annotationsByName.canvas_update_node).toMatchObject({
    readonly: false,
    destructive: false,
    idempotent: true,
  });
  expect(annotationsByName.canvas_remove_node).toMatchObject({
    readonly: false,
    destructive: true,
    idempotent: false,
  });
});
