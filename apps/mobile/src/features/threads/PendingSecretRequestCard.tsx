import type { RuntimeRequestId, ThreadSecretRequestResponse } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { enterFade, exitFade } from "../../lib/motion";
import type { PendingSecretRequest } from "../../lib/threadActivity";
import { useGlassChromeActive } from "../scenery/SceneryProvider";
import { ComposerStackCard } from "./composer-stack-card";

export interface PendingSecretRequestCardProps {
  readonly request: PendingSecretRequest;
  readonly respondingRequestId: RuntimeRequestId | null;
  readonly onRespond: (
    requestId: RuntimeRequestId,
    response: ThreadSecretRequestResponse,
  ) => Promise<unknown>;
}

/**
 * An agent's API key prompt. The value goes over its own RPC into the secret
 * store, never through the composer or the event log.
 */
export function PendingSecretRequestCard(props: PendingSecretRequestCardProps) {
  const glass = useGlassChromeActive();
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const isResponding = props.respondingRequestId === props.request.requestId;
  const canSubmit = trimmed.length > 0 && !isResponding;
  const submit = () => {
    if (!canSubmit) return;
    void props.onRespond(props.request.requestId, { kind: "provided", value: trimmed });
  };
  // Opaque (or frosted over scenery) for the same reason as PendingUserInputCard:
  // a plain translucent surface bleeds the feed's messages through it.
  return (
    <ComposerStackCard
      entering={enterFade}
      exiting={exitFade}
      className="gap-2.5 rounded-[20px] border border-border bg-card-alt p-4"
      glassClassName="gap-2.5 p-4"
    >
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
        API key needed
      </Text>
      <Text className="font-t3-bold text-lg text-foreground">{props.request.header}</Text>
      <Text className="font-sans text-sm leading-normal text-foreground-secondary">
        {props.request.purpose}
      </Text>
      <Text className="font-sans text-xs leading-normal text-foreground-muted">
        Saved as {props.request.name} on the server, never in the chat or thread history.
      </Text>
      <TextInput
        className={glass ? "border-chrome-glass-border bg-foreground/5" : undefined}
        style={glass ? { borderWidth: StyleSheet.hairlineWidth } : undefined}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!isResponding}
        onChangeText={setValue}
        onSubmitEditing={submit}
        placeholder={`Paste your ${props.request.name}`}
        returnKeyType="done"
        secureTextEntry
        value={value}
      />
      <View className="flex-row flex-wrap gap-2.5">
        <Pressable
          className={`items-center justify-center rounded-[14px] bg-primary px-3.5 py-3 ${
            canSubmit ? "" : "opacity-50"
          }`}
          disabled={!canSubmit}
          onPress={submit}
        >
          <Text className="font-t3-extrabold text-sm text-primary-foreground">
            {isResponding ? "Saving…" : "Save key"}
          </Text>
        </Pressable>
        <Pressable
          className="items-center justify-center rounded-[14px] bg-subtle-strong px-3.5 py-3"
          disabled={isResponding}
          onPress={() => void props.onRespond(props.request.requestId, { kind: "declined" })}
        >
          <Text className="font-t3-bold text-sm text-foreground">Decline</Text>
        </Pressable>
      </View>
    </ComposerStackCard>
  );
}
