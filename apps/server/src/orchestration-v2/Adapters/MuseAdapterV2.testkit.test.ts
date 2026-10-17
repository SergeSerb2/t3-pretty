import { assert, it } from "@effect/vitest";

import { museReplayEntryHost } from "./MuseAdapterV2.testkit.ts";

it("closes the stamped Muse host on runtime_exit, not the newest host", () => {
  assert.strictEqual(museReplayEntryHost({ type: "runtime_exit", status: "success" }), 1);
  assert.strictEqual(
    museReplayEntryHost({ type: "runtime_exit", status: "success", label: "runtime_exit@h2" }),
    2,
  );
});
