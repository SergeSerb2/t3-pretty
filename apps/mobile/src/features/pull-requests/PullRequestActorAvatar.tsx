import type { PullRequestActor } from "@t3tools/contracts";
import { Image } from "expo-image";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { useThemeColor } from "../../lib/useThemeColor";

function actorInitials(actor: PullRequestActor | null): string {
  const source = actor?.name?.trim() || actor?.login || "?";
  const parts = source.split(/\s+/u).filter((part) => part.length > 0);
  if (parts.length >= 2) {
    return `${parts[0]!.charAt(0)}${parts[1]!.charAt(0)}`.toUpperCase();
  }
  return source.slice(0, 2).toUpperCase();
}

export function PullRequestActorAvatar(props: {
  readonly actor: PullRequestActor | null;
  readonly size?: number;
}) {
  const size = props.size ?? 28;
  const [failed, setFailed] = useState(false);
  const muted = useThemeColor("--color-foreground-muted");
  const avatarUrl = props.actor?.avatarUrl ?? null;
  useEffect(() => {
    setFailed(false);
  }, [avatarUrl]);
  const uri = failed ? null : avatarUrl;
  const radius = size / 2;

  return (
    <View
      className="items-center justify-center overflow-hidden bg-subtle"
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {uri ? (
        <Image
          accessibilityIgnoresInvertColors
          onError={() => setFailed(true)}
          recyclingKey={uri}
          source={{ uri }}
          style={{ width: size, height: size }}
        />
      ) : (
        <Text
          className="font-t3-bold text-foreground-muted"
          style={{ fontSize: Math.max(9, Math.round(size * 0.36)), color: String(muted) }}
        >
          {actorInitials(props.actor)}
        </Text>
      )}
    </View>
  );
}
