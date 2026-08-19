import { describe, expect, it } from "vite-plus/test";

import { canOpenFixFindingMenu, fixFindingMenuItems } from "./FixFindingButton";

describe("fix finding menu", () => {
  it("offers this thread first when the pull request belongs to the open composer", () => {
    expect(
      fixFindingMenuItems({
        thisThreadLabel: "Fix in this thread",
        otherThreadLabel: "Fix in another thread",
        canFixInThisThread: true,
      }),
    ).toEqual([
      { id: "this-thread", label: "Fix in this thread", disabled: false },
      { id: "new-thread", label: "Fix in another thread" },
    ]);
  });

  it("does not open while a hand-off is already preparing", () => {
    expect(canOpenFixFindingMenu({ disabled: false, pending: false })).toBe(true);
    expect(canOpenFixFindingMenu({ disabled: true, pending: false })).toBe(false);
    expect(canOpenFixFindingMenu({ disabled: false, pending: true })).toBe(false);
  });

  it("keeps this thread visible but disabled on the standalone page", () => {
    expect(
      fixFindingMenuItems({
        thisThreadLabel: "Fix in this thread",
        otherThreadLabel: "Fix in another thread",
        canFixInThisThread: false,
      })[0],
    ).toMatchObject({ id: "this-thread", disabled: true });
  });
});
