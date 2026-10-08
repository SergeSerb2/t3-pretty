import { describe, expect, it } from "vite-plus/test";

import { headerMenuActions } from "./mintGlassHeaderMenu.logic";

describe("headerMenuActions", () => {
  it("routes nested actions back to their handlers and keeps their state", () => {
    const pressed: string[] = [];
    const { actions, handlers } = headerMenuActions([
      {
        type: "action",
        label: "Refresh",
        icon: { type: "sfSymbol", name: "arrow.clockwise" },
        onPress: () => pressed.push("refresh"),
      },
      {
        type: "submenu",
        label: "Environment",
        inline: true,
        items: [
          { type: "action", label: "All", state: "on", onPress: () => pressed.push("all") },
          {
            type: "action",
            label: "Remove",
            destructive: true,
            disabled: true,
            onPress: () => pressed.push("remove"),
          },
        ],
      },
    ]);

    expect(actions[0]).toMatchObject({ id: "0", title: "Refresh", image: "arrow.clockwise" });
    expect(actions[1]).toMatchObject({ id: "1", displayInline: true });
    expect(actions[1]?.subactions?.[0]).toMatchObject({ id: "1.0", state: "on" });
    expect(actions[1]?.subactions?.[1]?.attributes).toEqual({ destructive: true, disabled: true });

    handlers.get("1.0")?.();
    handlers.get("0")?.();
    expect(pressed).toEqual(["all", "refresh"]);
    expect(handlers.has("1")).toBe(false);
  });
});
