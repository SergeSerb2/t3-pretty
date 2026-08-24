import { describe, expect, it } from "vite-plus/test";

import {
  agentBrowserCursorOpacity,
  agentCursorActionLabel,
  agentCursorGlideMs,
} from "./agentBrowserCursorLogic";

describe("agentCursorGlideMs", () => {
  it("scales with distance inside the 120-280ms band", () => {
    expect(agentCursorGlideMs(0)).toBe(0);
    expect(agentCursorGlideMs(-5)).toBe(0);
    expect(agentCursorGlideMs(Number.NaN)).toBe(0);
    expect(agentCursorGlideMs(10)).toBe(120);
    expect(agentCursorGlideMs(500)).toBe(200);
    expect(agentCursorGlideMs(5000)).toBe(280);
  });

  it("never exceeds the desktop click lead", () => {
    // Manager.ts sleeps AGENT_CURSOR_MOVE_MS (300ms) between the move and
    // click events; the glide must finish first so the ripple lands on a
    // settled cursor.
    expect(agentCursorGlideMs(Number.MAX_SAFE_INTEGER)).toBeLessThan(300);
  });
});

describe("agentCursorActionLabel", () => {
  it("labels action phases and stays silent on moves", () => {
    expect(agentCursorActionLabel("click")).toBe("Click");
    expect(agentCursorActionLabel("type")).toBe("Type");
    expect(agentCursorActionLabel("scroll")).toBe("Scroll");
    expect(agentCursorActionLabel("move")).toBeNull();
  });
});

describe("agentBrowserCursorOpacity", () => {
  it("dims by controller once inactive", () => {
    expect(agentBrowserCursorOpacity(true, "agent")).toBe(1);
    expect(agentBrowserCursorOpacity(true, "human")).toBe(1);
    expect(agentBrowserCursorOpacity(false, "human")).toBe(0.18);
    expect(agentBrowserCursorOpacity(false, "agent")).toBe(0.35);
    expect(agentBrowserCursorOpacity(false, "none")).toBe(0.35);
  });
});
