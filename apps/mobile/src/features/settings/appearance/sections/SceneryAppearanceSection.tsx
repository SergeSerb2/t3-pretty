/**
 * Settings → Appearance section for the World Scenery theme: the mobile
 * counterpart of the desktop's scenery rows (enable, blur, photo presence).
 * The wash follows the chosen color scheme, as on desktop.
 */
import { isBoringMobileTheme } from "../../../../lib/mobileTheme";
import { BLUR_RANGE } from "../../../scenery/sceneryLogic";
import {
  photoPresenceToTranslucency,
  translucencyToPhotoPresence,
} from "@t3tools/client-runtime/state/scenery-sync";
import { useScenery } from "../../../scenery/SceneryProvider";
import { SettingsSection } from "../../components/SettingsSection";
import { SettingsSwitchRow } from "../../components/SettingsSwitchRow";
import { FontSizeSliderRow } from "../components/FontSizeSliderRow";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";

export function SceneryAppearanceSection() {
  const { themeId } = useAppearancePreferences();
  const { isReady, enabled, blur, translucency, setEnabled, setBlur, setTranslucency } =
    useScenery();

  if (isBoringMobileTheme(themeId)) {
    return null;
  }

  return (
    <SettingsSection title="World Scenery">
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
            onChange={(value) => setTranslucency(photoPresenceToTranslucency(value))}
            step={5}
            value={translucencyToPhotoPresence(translucency)}
            valueLabel={`${translucencyToPhotoPresence(translucency)}%`}
          />
        </>
      ) : null}
    </SettingsSection>
  );
}
