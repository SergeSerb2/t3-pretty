import { View, type ColorValue } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { ProviderIcon } from "../../components/ProviderIcon";
import type { ThreadModelIdentity } from "./threadModelIdentity";

/**
 * Centered chat header lockup: thread title, the model this thread is
 * running, then project/environment. Lives in the native title slot so it
 * does not cover the transcript.
 */
export function ThreadChatHeaderTitle(props: {
  readonly title: string;
  readonly location: string;
  readonly identity: ThreadModelIdentity | null;
  readonly tintColor?: ColorValue;
}) {
  const accessibilityLabel = [props.title, props.identity?.accessibilityLabel, props.location]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join(". ");
  const titleColor = props.tintColor;

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="header"
      collapsable={false}
      style={{ alignItems: "center", maxWidth: 248, minWidth: 0 }}
    >
      <Text
        className="text-center text-[17px] font-t3-extrabold leading-[22px] text-foreground"
        numberOfLines={1}
        style={titleColor === undefined ? undefined : { color: titleColor }}
      >
        {props.title}
      </Text>
      {props.identity ? (
        <View className="mt-px max-w-full flex-row items-center justify-center gap-1">
          <View style={titleColor === undefined ? undefined : { opacity: 0.82 }}>
            <ProviderIcon provider={props.identity.providerDriver} size={12} />
          </View>
          <Text
            className="shrink text-center text-[12px] font-t3-medium leading-[16px] text-foreground-secondary"
            numberOfLines={1}
            style={titleColor === undefined ? undefined : { color: titleColor, opacity: 0.82 }}
          >
            {props.identity.compactLabel}
          </Text>
        </View>
      ) : null}
      {props.location.length > 0 ? (
        <Text
          className="text-center text-[11px] font-t3-medium leading-[14px] text-foreground-muted"
          numberOfLines={1}
          style={titleColor === undefined ? undefined : { color: titleColor, opacity: 0.55 }}
        >
          {props.location}
        </Text>
      ) : null}
    </View>
  );
}
