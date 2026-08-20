/**
 * World Scenery controls that used to live in the bottom-right dock. They
 * only mount from Settings → Appearance while the theme is active, so the
 * photo engine stays out of the settings chunk until then.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { SettingResetButton, SettingsRow } from "../components/settings/settingsLayout";
import { searchableSetting } from "../components/settings/settingsSearch";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import { Switch } from "../components/ui/switch";
import { DEFAULT_TRANSLUCENCY, TRANSLUCENCY_RANGE } from "./glass";
import { useMotionStore } from "./motionStore";
import { BLUR_RANGE, DEFAULT_BLUR, useSceneryStore, type SceneryInkMode } from "./sceneryStore";

const BLUR_COMMIT_DELAY_MS = 250;

const INK_OPTIONS: ReadonlyArray<{ mode: SceneryInkMode; label: string }> = [
  { mode: "auto", label: "Auto" },
  { mode: "light", label: "White" },
  { mode: "dark", label: "Black" },
  { mode: "off", label: "App" },
];

const { lowerBound: T_MIN, upperBound: T_MAX } = TRANSLUCENCY_RANGE;
const DEFAULT_PHOTO_PRESENCE = translucencyToPercent(DEFAULT_TRANSLUCENCY);

function translucencyToPercent(translucency: number): number {
  return Math.round(((translucency - T_MIN) / (T_MAX - T_MIN)) * 100);
}

function percentToTranslucency(percent: number): number {
  return T_MIN + (percent / 100) * (T_MAX - T_MIN);
}

function sliderStyle(ratio: number): CSSProperties {
  return {
    "--settings-slider-progress": `${ratio * 100}%`,
    "--settings-slider-fill-offset": `${0.5 - ratio}rem`,
  } as CSSProperties;
}

export default function SceneryAppearanceSettings() {
  const blur = useSceneryStore((state) => state.blur);
  const translucency = useSceneryStore((state) => state.translucency);
  const inkMode = useSceneryStore((state) => state.inkMode);
  const setBlur = useSceneryStore((state) => state.setBlur);
  const setTranslucency = useSceneryStore((state) => state.setTranslucency);
  const setInkMode = useSceneryStore((state) => state.setInkMode);
  const motionEnabled = useMotionStore((state) => state.enabled);
  const setMotionEnabled = useMotionStore((state) => state.setEnabled);

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

  const photoPresence = translucencyToPercent(translucency);
  const blurRatio = useMemo(
    () => (blurDraft - BLUR_RANGE.lowerBound) / (BLUR_RANGE.upperBound - BLUR_RANGE.lowerBound),
    [blurDraft],
  );

  return (
    <>
      <SettingsRow
        {...searchableSetting("setting-photo-blur")}
        description="How softly the thread's landscape photo is rendered. Higher values keep chrome readable; lower values show more of the place."
        resetAction={
          blur !== DEFAULT_BLUR ? (
            <SettingResetButton
              label="photo blur"
              onClick={() => {
                setBlurDraft(DEFAULT_BLUR);
                setBlur(DEFAULT_BLUR);
              }}
            />
          ) : null
        }
        control={
          <div className="flex w-full items-center gap-3 sm:w-52">
            <output
              className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
              htmlFor="scenery-photo-blur"
            >
              {blurDraft}
            </output>
            <input
              aria-label="Photo blur"
              className="settings-slider min-w-0 flex-1"
              id="scenery-photo-blur"
              max={BLUR_RANGE.upperBound}
              min={BLUR_RANGE.lowerBound}
              onChange={(event) => onBlurInput(Number(event.currentTarget.value))}
              step={1}
              style={sliderStyle(blurRatio)}
              type="range"
              value={blurDraft}
            />
          </div>
        }
      />

      <SettingsRow
        {...searchableSetting("setting-photo-presence")}
        description="How much of the landscape shows through the chat. Higher values let more of the photo through."
        resetAction={
          photoPresence !== DEFAULT_PHOTO_PRESENCE ? (
            <SettingResetButton
              label="photo presence"
              onClick={() => setTranslucency(percentToTranslucency(DEFAULT_PHOTO_PRESENCE))}
            />
          ) : null
        }
        control={
          <div className="flex w-full items-center gap-3 sm:w-52">
            <output
              className="min-w-12 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs font-medium tabular-nums text-foreground"
              htmlFor="scenery-photo-presence"
            >
              {photoPresence}%
            </output>
            <input
              aria-label="Photo presence"
              className="settings-slider min-w-0 flex-1"
              id="scenery-photo-presence"
              max={100}
              min={0}
              onChange={(event) =>
                setTranslucency(percentToTranslucency(Number(event.currentTarget.value)))
              }
              step={1}
              style={sliderStyle(photoPresence / 100)}
              type="range"
              value={photoPresence}
            />
          </div>
        }
      />

      <SettingsRow
        {...searchableSetting("setting-scenery-motion")}
        description="Animate arriving messages and the new-thread fog sequence. Turn this off if you prefer a still thread."
        resetAction={
          !motionEnabled ? (
            <SettingResetButton label="thread motion" onClick={() => setMotionEnabled(true)} />
          ) : null
        }
        control={
          <Switch
            aria-label="Thread motion"
            checked={motionEnabled}
            onCheckedChange={(checked) => setMotionEnabled(Boolean(checked))}
          />
        }
      />

      <SettingsRow
        {...searchableSetting("setting-scenery-text-color")}
        description="Chat ink over the photo. Auto picks per thread from the landscape; App follows the appearance setting."
        resetAction={
          inkMode !== "auto" ? (
            <SettingResetButton label="scenery text color" onClick={() => setInkMode("auto")} />
          ) : null
        }
        control={
          <Select
            value={inkMode}
            onValueChange={(value) => {
              if (value === "auto" || value === "light" || value === "dark" || value === "off") {
                setInkMode(value);
              }
            }}
          >
            <SelectTrigger className="w-full sm:w-40" aria-label="Scenery text color">
              <SelectValue>
                {INK_OPTIONS.find((option) => option.mode === inkMode)?.label ?? "Auto"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              {INK_OPTIONS.map((option) => (
                <SelectItem hideIndicator key={option.mode} value={option.mode}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        }
      />
    </>
  );
}
