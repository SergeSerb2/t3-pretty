import { View } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";

import { AppText as Text } from "../../components/AppText";

function BotIcon(props: { readonly size: number; readonly color: string }) {
  return (
    <Svg
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={props.color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <Path d="M12 8V4H8" />
      <Path d="M4 8h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2z" />
      <Path d="M2 14h2" />
      <Path d="M20 14h2" />
      <Circle cx={9} cy={13} r={0.5} fill={props.color} />
      <Circle cx={15} cy={13} r={0.5} fill={props.color} />
    </Svg>
  );
}

export function ThreadActiveSubagentCount(props: {
  readonly count: number | undefined;
  readonly color: string;
  readonly size?: number;
}) {
  const count = props.count ?? 0;
  if (count <= 0) return null;
  return (
    <View
      accessible={false}
      className="flex-row items-center gap-0.5"
      importantForAccessibility="no-hide-descendants"
    >
      <BotIcon size={props.size ?? 12} color={props.color} />
      <Text className="text-3xs font-t3-medium tabular-nums" style={{ color: props.color }}>
        {count}
      </Text>
    </View>
  );
}
