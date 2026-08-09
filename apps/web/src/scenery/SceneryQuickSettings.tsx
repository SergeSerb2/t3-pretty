/**
 * Bottom-right quick controls for the scenery: photo blur, photo presence
 * (the glass translucency), and the ink mode. Lives entirely inside the
 * scenery layer chunk — no upstream settings surface is touched.
 *
 * Blur commits are debounced: every distinct blur value is a distinct CDN
 * render, so committing mid-drag would fetch a wallpaper per slider step.
 * Translucency and ink are plain CSS/state changes and commit immediately.
 */
import { useEffect, useRef, useState } from "react";

import { TRANSLUCENCY_RANGE } from "./glass";
import { useMotionStore } from "./motionStore";
import { BLUR_RANGE, useSceneryStore, type SceneryInkMode } from "./sceneryStore";

const BLUR_COMMIT_DELAY_MS = 250;

const INK_OPTIONS: ReadonlyArray<{ mode: SceneryInkMode; label: string; title: string }> = [
  { mode: "auto", label: "Auto", title: "Pick per thread from the photo" },
  { mode: "light", label: "White", title: "Always white text" },
  { mode: "dark", label: "Black", title: "Always black text" },
  { mode: "off", label: "App", title: "Follow the app appearance" },
];

/** Photo presence percent ↔ translucency (0% = thinnest stack, 100% = full). */
const { lowerBound: T_MIN, upperBound: T_MAX } = TRANSLUCENCY_RANGE;

function translucencyToPercent(translucency: number): number {
  return Math.round(((translucency - T_MIN) / (T_MAX - T_MIN)) * 100);
}

function percentToTranslucency(percent: number): number {
  return T_MIN + (percent / 100) * (T_MAX - T_MIN);
}

export function SceneryQuickSettings() {
  const [open, setOpen] = useState(false);
  const translucency = useSceneryStore((state) => state.translucency);
  const blur = useSceneryStore((state) => state.blur);
  const inkMode = useSceneryStore((state) => state.inkMode);
  const setTranslucency = useSceneryStore((state) => state.setTranslucency);
  const setBlur = useSceneryStore((state) => state.setBlur);
  const setInkMode = useSceneryStore((state) => state.setInkMode);
  const motionEnabled = useMotionStore((state) => state.enabled);
  const setMotionEnabled = useMotionStore((state) => state.setEnabled);

  // Slider position is local so dragging feels live; the store (and the
  // CDN fetch it triggers) hears about it after the debounce.
  const [blurDraft, setBlurDraft] = useState(blur);
  useEffect(() => setBlurDraft(blur), [blur]);
  const blurTimer = useRef<number | null>(null);
  const onBlurInput = (value: number) => {
    setBlurDraft(value);
    if (blurTimer.current !== null) {
      window.clearTimeout(blurTimer.current);
    }
    blurTimer.current = window.setTimeout(() => setBlur(value), BLUR_COMMIT_DELAY_MS);
  };
  useEffect(
    () => () => {
      if (blurTimer.current !== null) {
        window.clearTimeout(blurTimer.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <>
      {open ? <div className="scenery-quick__backdrop" onClick={() => setOpen(false)} /> : null}
      <button
        type="button"
        className="scenery-quick__trigger"
        aria-label="Scenery settings"
        aria-expanded={open}
        title="Scenery settings"
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden fill="none">
          <path
            d="M2 4.5h8m2.5 0H14M2 11.5h3m2.5 0H14M10 3v3M5 10v3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
      {open ? (
        <div className="scenery-quick__panel" role="dialog" aria-label="Scenery settings">
          <label className="scenery-quick__row">
            <span className="scenery-quick__label">
              Blur <span className="scenery-quick__value">{blurDraft}</span>
            </span>
            <input
              type="range"
              min={BLUR_RANGE.lowerBound}
              max={BLUR_RANGE.upperBound}
              step={1}
              value={blurDraft}
              onChange={(event) => onBlurInput(Number(event.target.value))}
            />
          </label>
          <label className="scenery-quick__row">
            <span className="scenery-quick__label">
              Photo presence{" "}
              <span className="scenery-quick__value">{translucencyToPercent(translucency)}%</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={translucencyToPercent(translucency)}
              onChange={(event) =>
                setTranslucency(percentToTranslucency(Number(event.target.value)))
              }
            />
          </label>
          <div className="scenery-quick__row">
            <span className="scenery-quick__label">Motion</span>
            <div className="scenery-quick__segments" role="group" aria-label="Motion">
              <button
                type="button"
                title="Animate the chat thread and show thinking orbs"
                aria-pressed={motionEnabled}
                onClick={() => setMotionEnabled(true)}
              >
                On
              </button>
              <button
                type="button"
                title="Keep the thread static"
                aria-pressed={!motionEnabled}
                onClick={() => setMotionEnabled(false)}
              >
                Off
              </button>
            </div>
          </div>
          <div className="scenery-quick__row">
            <span className="scenery-quick__label">Text color</span>
            <div className="scenery-quick__segments" role="group" aria-label="Text color">
              {INK_OPTIONS.map((option) => (
                <button
                  key={option.mode}
                  type="button"
                  title={option.title}
                  aria-pressed={inkMode === option.mode}
                  onClick={() => setInkMode(option.mode)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
