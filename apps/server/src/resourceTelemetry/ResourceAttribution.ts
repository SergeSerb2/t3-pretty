import {
  RESOURCE_ATTRIBUTION_ENTRY_MAX_COUNT,
  RESOURCE_ATTRIBUTION_LABEL_MAX_LENGTH,
  type ResourceAttributionEntry,
  type ResourceAttributionSnapshot,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

export interface ResourceAttributionRecord {
  readonly component: string;
  readonly operation: string;
  readonly logicalReadBytes?: number;
  readonly logicalWriteBytes?: number;
  readonly count?: number;
  readonly durationMs?: number;
}

export class ResourceAttribution extends Context.Service<
  ResourceAttribution,
  {
    readonly record: (input: ResourceAttributionRecord) => Effect.Effect<void>;
    readonly snapshot: Effect.Effect<ResourceAttributionSnapshot>;
  }
>()("t3/resourceTelemetry/ResourceAttribution") {}

interface ResourceAttributionState {
  readonly entries: ReadonlyMap<string, ResourceAttributionEntry>;
  readonly entriesTruncated: boolean;
}

const OVERFLOW_COMPONENT = "other";
const OVERFLOW_OPERATION = "overflow";

function key(input: Pick<ResourceAttributionRecord, "component" | "operation">): string {
  return `${input.component}\u0000${input.operation}`;
}

function normalizeLabel(value: string): string {
  const trimmed = value.trim();
  return (trimmed.length === 0 ? "unknown" : trimmed).slice(
    0,
    RESOURCE_ATTRIBUTION_LABEL_MAX_LENGTH,
  );
}

function nonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.round(value)));
}

function saturatingAdd(left: number, right: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}

function accumulateEntry(
  existing: ResourceAttributionEntry | undefined,
  input: ResourceAttributionRecord,
  component: string,
  operation: string,
): ResourceAttributionEntry {
  return {
    component,
    operation,
    logicalReadBytes: saturatingAdd(
      existing?.logicalReadBytes ?? 0,
      nonNegativeInteger(input.logicalReadBytes, 0),
    ),
    logicalWriteBytes: saturatingAdd(
      existing?.logicalWriteBytes ?? 0,
      nonNegativeInteger(input.logicalWriteBytes, 0),
    ),
    count: saturatingAdd(existing?.count ?? 0, nonNegativeInteger(input.count, 1)),
    durationMs: saturatingAdd(existing?.durationMs ?? 0, nonNegativeInteger(input.durationMs, 0)),
  };
}

export const make = Effect.fn("resourceTelemetry.resourceAttribution.make")(function* () {
  const state = yield* Ref.make<ResourceAttributionState>({
    entries: new Map(),
    entriesTruncated: false,
  });

  const record: ResourceAttribution["Service"]["record"] = (input) =>
    Ref.update(state, (current) => {
      const component = normalizeLabel(input.component);
      const operation = normalizeLabel(input.operation);
      const entryKey = key({ component, operation });
      const existing = current.entries.get(entryKey);
      const next = new Map(current.entries);
      if (existing !== undefined || next.size < RESOURCE_ATTRIBUTION_ENTRY_MAX_COUNT - 1) {
        next.set(entryKey, accumulateEntry(existing, input, component, operation));
        return { ...current, entries: next };
      }

      const overflowKey = key({
        component: OVERFLOW_COMPONENT,
        operation: OVERFLOW_OPERATION,
      });
      next.set(
        overflowKey,
        accumulateEntry(next.get(overflowKey), input, OVERFLOW_COMPONENT, OVERFLOW_OPERATION),
      );
      return {
        entries: next,
        entriesTruncated: true,
      };
    });

  return ResourceAttribution.of({
    record,
    snapshot: Effect.gen(function* () {
      const readAt = yield* DateTime.now;
      const current = yield* Ref.get(state);
      return {
        readAt,
        entries: [...current.entries.values()].toSorted(
          (left, right) => right.logicalWriteBytes - left.logicalWriteBytes,
        ),
        ...(current.entriesTruncated ? { entriesTruncated: true } : {}),
      };
    }),
  });
});

export const layer = Layer.effect(ResourceAttribution, make());
