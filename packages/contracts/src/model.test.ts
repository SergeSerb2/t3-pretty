import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ModelCapabilities,
  PROVIDER_OPTION_AGGREGATE_MAX_CHOICES,
  PROVIDER_OPTION_AGGREGATE_MAX_TEXT_CHARS,
  PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH,
  PROVIDER_OPTION_ID_MAX_LENGTH,
  PROVIDER_OPTION_SELECTION_MAX_COUNT,
  PROVIDER_OPTION_VALUE_MAX_LENGTH,
  ProviderOptionSelections,
} from "./model.ts";

const decodeModelCapabilities = Schema.decodeUnknownSync(ModelCapabilities);
const decodeProviderOptionSelections = Schema.decodeUnknownSync(ProviderOptionSelections);

describe("ProviderOptionSelections legacy compatibility", () => {
  it("normalizes duplicate canonical ids with stable first-selection semantics", () => {
    expect(
      decodeProviderOptionSelections([
        { id: "effort", value: "high" },
        { id: "effort", value: "low" },
        { id: "fastMode", value: true },
      ]),
    ).toEqual([
      { id: "effort", value: "high" },
      { id: "fastMode", value: true },
    ]);
  });

  it("drops invalid legacy entries and retains a bounded canonical prefix", () => {
    const decoded = decodeProviderOptionSelections({
      ["x".repeat(PROVIDER_OPTION_ID_MAX_LENGTH + 1)]: "ignored",
      oversizedValue: "x".repeat(PROVIDER_OPTION_VALUE_MAX_LENGTH + 1),
      effort: " high ",
      fastMode: true,
      nested: { ignored: true },
    });

    expect(decoded).toEqual([
      { id: "effort", value: "high" },
      { id: "fastMode", value: true },
    ]);

    expect(
      decodeProviderOptionSelections(
        Object.fromEntries(
          Array.from({ length: PROVIDER_OPTION_SELECTION_MAX_COUNT + 1 }, (_, index) => [
            `option-${index}`,
            true,
          ]),
        ),
      ),
    ).toHaveLength(PROVIDER_OPTION_SELECTION_MAX_COUNT);
  });
});

describe("ModelCapabilities aggregate bounds", () => {
  it("rejects duplicate descriptor and choice ids", () => {
    expect(() =>
      decodeModelCapabilities({
        optionDescriptors: [
          { id: "effort", label: "Effort", type: "boolean" },
          { id: "effort", label: "Effort again", type: "boolean" },
        ],
      }),
    ).toThrow();
    expect(() =>
      decodeModelCapabilities({
        optionDescriptors: [
          {
            id: "effort",
            label: "Effort",
            type: "select",
            options: [
              { id: "high", label: "High" },
              { id: "high", label: "High again" },
            ],
          },
        ],
      }),
    ).toThrow();
  });

  it("rejects multiplicative choice collections beyond the per-model budget", () => {
    expect(() =>
      decodeModelCapabilities({
        optionDescriptors: Array.from({ length: 17 }, (_, descriptorIndex) => ({
          id: `option-${descriptorIndex}`,
          label: `Option ${descriptorIndex}`,
          type: "select",
          options: Array.from({ length: 128 }, (_, choiceIndex) => ({
            id: `choice-${choiceIndex}`,
            label: `Choice ${choiceIndex}`,
          })),
        })),
      }),
    ).toThrow();
    expect(PROVIDER_OPTION_AGGREGATE_MAX_CHOICES).toBeLessThan(17 * 128);
  });

  it("rejects aggregate descriptor text beyond the per-model budget", () => {
    const description = "x".repeat(PROVIDER_OPTION_DESCRIPTION_MAX_LENGTH);

    expect(() =>
      decodeModelCapabilities({
        optionDescriptors: Array.from({ length: 2 }, (_, index) => ({
          id: `option-${index}`,
          label: `Option ${index}`,
          type: "select",
          options: Array.from({ length: 128 }, (_, choiceIndex) => ({
            id: `choice-${choiceIndex}`,
            label: `Choice ${choiceIndex}`,
            description,
          })),
        })),
      }),
    ).toThrow();
    expect(2 * 128 * description.length).toBeGreaterThanOrEqual(
      PROVIDER_OPTION_AGGREGATE_MAX_TEXT_CHARS,
    );
  });
});
