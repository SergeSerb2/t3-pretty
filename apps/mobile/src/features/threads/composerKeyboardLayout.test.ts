import { describe, expect, it } from "vite-plus/test";

import {
  COMPOSER_RESTING_SAFE_AREA,
  deriveComposerBottomInset,
  deriveKeyboardAvoidPadding,
  deriveStaleKeyboardPaddingCancel,
} from "./composerKeyboardLayout";

describe("deriveComposerBottomInset", () => {
  it("docks below the home indicator and scenery credit at rest", () => {
    expect(
      deriveComposerBottomInset({
        atKeyboardEdge: false,
        keyboardVisible: false,
        safeAreaBottom: 34,
        sceneryCreditHeight: 22,
      }),
    ).toBe(56);
  });

  it("uses the resting minimum when the safe-area inset is smaller", () => {
    expect(
      deriveComposerBottomInset({
        atKeyboardEdge: false,
        keyboardVisible: false,
        safeAreaBottom: 0,
        sceneryCreditHeight: 0,
      }),
    ).toBe(COMPOSER_RESTING_SAFE_AREA);
  });

  it("sits flush on the IME when the composer is at the keyboard edge", () => {
    expect(
      deriveComposerBottomInset({
        atKeyboardEdge: true,
        keyboardVisible: true,
        safeAreaBottom: 34,
        sceneryCreditHeight: 22,
      }),
    ).toBe(0);
  });

  it("keeps the credit hidden while focused even if visibility flickers closed", () => {
    expect(
      deriveComposerBottomInset({
        atKeyboardEdge: true,
        keyboardVisible: false,
        safeAreaBottom: 34,
        sceneryCreditHeight: 22,
      }),
    ).toBe(0);
  });

  it("keeps the credit hidden while the IME is still reported visible", () => {
    expect(
      deriveComposerBottomInset({
        atKeyboardEdge: false,
        keyboardVisible: true,
        safeAreaBottom: 34,
        sceneryCreditHeight: 22,
      }),
    ).toBe(34);
  });
});

describe("deriveStaleKeyboardPaddingCancel", () => {
  it("leaves list padding alone while the composer is translating", () => {
    expect(
      deriveStaleKeyboardPaddingCancel({
        translationEnabled: true,
        keyboardTranslateY: -336,
      }),
    ).toBe(0);
  });

  it("cancels a stale open height when translation is disabled", () => {
    expect(
      deriveStaleKeyboardPaddingCancel({
        translationEnabled: false,
        keyboardTranslateY: -336,
      }),
    ).toBe(-336);
  });

  it("is a no-op when the animated height is already closed", () => {
    expect(
      deriveStaleKeyboardPaddingCancel({
        translationEnabled: false,
        keyboardTranslateY: 0,
      }),
    ).toBe(0);
  });
});

describe("deriveKeyboardAvoidPadding", () => {
  it("lifts by the live IME height while visible", () => {
    expect(
      deriveKeyboardAvoidPadding({
        visible: true,
        keyboardTranslateY: -336,
      }),
    ).toBe(336);
  });

  it("drops padding when visibility says the keyboard is closed", () => {
    expect(
      deriveKeyboardAvoidPadding({
        visible: false,
        keyboardTranslateY: -336,
      }),
    ).toBe(0);
  });
});
