/**
 * Settings → Appearance section for the World Scenery theme: the mobile
 * counterpart of the desktop's quick-settings dock (enable, blur, photo
 * presence). Text color (ink) modes stay desktop-only for now — the mobile
 * wash follows the system appearance.
 */
import { isBoringMobileTheme } from "../../../../lib/mobileTheme";
import { BLUR_RANGE, TRANSLUCENCY_RANGE } from "../../../scenery/sceneryLogic";
import { useScenery } from "../../../scenery/SceneryProvider";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { FontSizeSliderRow } from "../components/FontSizeSliderRow";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

/** Slider scale for "how much photo shows through": 0% ⇔ translucency 1
 *  (fully covered), 100% ⇔ translucency 0.5 (the glass end). */
function translucencyToPresence(translucency: number): number {
  return Math.round(
    ((TRANSLUCENCY_RANGE.upperBound - translucency) /
      (TRANSLUCENCY_RANGE.upperBound - TRANSLUCENCY_RANGE.lowerBound)) *
      100,
  );
}

function presenceToTranslucency(presence: number): number {
  return (
    TRANSLUCENCY_RANGE.upperBound -
    (presence / 100) * (TRANSLUCENCY_RANGE.upperBound - TRANSLUCENCY_RANGE.lowerBound)
  );
}

export function SceneryAppearanceSection() {
  const { themeId } = useAppearancePreferences();
  const { isReady, enabled, blur, translucency, setEnabled, setBlur, setTranslucency } =
    useScenery();

  if (isBoringMobileTheme(themeId)) {
    return null;
  }

  return (
    <SettingsSection card title="World Scenery">
      <SettingsSwitchRow
        disabled={!isReady}
        icon="photo.on.rectangle"
        label="Scenery photos"
        onValueChange={setEnabled}
        value={enabled}
      />
      {enabled ? (
        <>
          <FontSizeSliderRow
            disabled={!isReady}
            icon="circle.lefthalf.filled"
            iconMax="circle.fill"
            iconMin="circle"
            label="Photo blur"
            max={BLUR_RANGE.upperBound}
            min={BLUR_RANGE.lowerBound}
            onChange={setBlur}
            step={5}
            value={blur}
            valueLabel={`${blur}%`}
          />
          <FontSizeSliderRow
            disabled={!isReady}
            icon="photo"
            iconMax="photo.fill"
            iconMin="photo"
            label="Photo presence"
            max={100}
            min={0}
            onChange={(value) => setTranslucency(presenceToTranslucency(value))}
            step={5}
            value={translucencyToPresence(translucency)}
            valueLabel={`${translucencyToPresence(translucency)}%`}
          />
        </>
      ) : null}
    </SettingsSection>
  );
}
