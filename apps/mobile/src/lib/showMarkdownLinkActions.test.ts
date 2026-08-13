import { Platform } from "react-native";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  impactAsync: vi.fn(),
  copyTextWithHaptic: vi.fn(),
  showActionSheetWithOptions: vi.fn(),
  alert: vi.fn(),
  share: vi.fn(),
}));

vi.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Medium: "medium" },
  impactAsync: mocks.impactAsync,
}));

vi.mock("./copyTextWithHaptic", () => ({
  copyTextWithHaptic: mocks.copyTextWithHaptic,
}));

vi.mock("react-native", () => ({
  ActionSheetIOS: { showActionSheetWithOptions: mocks.showActionSheetWithOptions },
  Alert: { alert: mocks.alert },
  Platform: { OS: "ios", isPad: false },
  Share: { share: mocks.share },
}));

import { showMarkdownLinkActionSheet } from "./showMarkdownLinkActions";

describe("showMarkdownLinkActionSheet", () => {
  const onOpen = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.impactAsync.mockResolvedValue(undefined);
    mocks.share.mockResolvedValue({ action: "sharedAction" });
    Object.assign(Platform, { OS: "ios", isPad: false });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("presents Open, Copy Link, and Share for a web link on iPhone", () => {
    showMarkdownLinkActionSheet({
      href: "https://example.com/docs?q=1",
      onOpen,
    });

    expect(mocks.showActionSheetWithOptions).toHaveBeenCalledWith(
      {
        options: ["Open", "Copy Link", "Share", "Cancel"],
        cancelButtonIndex: 3,
        title: "example.com",
      },
      expect.any(Function),
    );
    expect(mocks.alert).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("opens the same destination the tap handler would", () => {
    mocks.showActionSheetWithOptions.mockImplementation((_options, callback) => {
      callback(0);
    });

    showMarkdownLinkActionSheet({
      href: "https://example.com/docs",
      onOpen,
    });

    expect(onOpen).toHaveBeenCalledWith("https://example.com/docs");
    expect(mocks.copyTextWithHaptic).not.toHaveBeenCalled();
  });

  it("copies the exact destination without opening it", () => {
    mocks.showActionSheetWithOptions.mockImplementation((_options, callback) => {
      callback(1);
    });

    showMarkdownLinkActionSheet({
      href: "https://example.com/docs?topic=menus#copy",
      onOpen,
    });

    expect(mocks.copyTextWithHaptic).toHaveBeenCalledWith(
      "https://example.com/docs?topic=menus#copy",
      { target: "markdown-link" },
    );
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("falls back to an alert on iPad where an action sheet needs an anchor", () => {
    Object.assign(Platform, { OS: "ios", isPad: true });

    showMarkdownLinkActionSheet({
      href: "https://example.com/docs",
      onOpen,
    });

    expect(mocks.showActionSheetWithOptions).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith(
      "example.com",
      "https://example.com/docs",
      expect.arrayContaining([
        expect.objectContaining({ text: "Open" }),
        expect.objectContaining({ text: "Copy Link" }),
        expect.objectContaining({ text: "Share" }),
        expect.objectContaining({ text: "Cancel", style: "cancel" }),
      ]),
    );
  });

  it("limits the Android alert to three buttons by omitting Share", () => {
    Object.assign(Platform, { OS: "android", isPad: false });

    showMarkdownLinkActionSheet({
      href: "https://example.com/docs",
      onOpen,
    });

    expect(mocks.showActionSheetWithOptions).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenCalledWith("example.com", "https://example.com/docs", [
      expect.objectContaining({ text: "Open" }),
      expect.objectContaining({ text: "Copy Link" }),
      expect.objectContaining({ text: "Cancel", style: "cancel" }),
    ]);
  });
});
