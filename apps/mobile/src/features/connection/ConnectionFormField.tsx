import { View } from "react-native";

import { AppText, AppTextInput, type AppTextInputProps } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { GLASS_INPUT_CLASS_NAME } from "../scenery/glassStyles";

type ConnectionFormFieldProps = Omit<AppTextInputProps, "accessibilityLabel" | "className"> & {
  readonly label: string;
  readonly className?: string;
  readonly glass?: boolean;
};

/** Labeled connection input with a native wrapper retained inside form sheets. */
export function ConnectionFormField({
  label,
  className,
  glass = false,
  ...inputProps
}: ConnectionFormFieldProps) {
  return (
    <View collapsable={false} className={cn("gap-1.5", className)}>
      <AppText
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted"
      >
        {label}
      </AppText>
      <AppTextInput
        {...inputProps}
        accessibilityLabel={label}
        className={glass ? cn(GLASS_INPUT_CLASS_NAME, "px-4 py-3.5") : "rounded-[14px] px-4 py-3.5"}
      />
    </View>
  );
}
