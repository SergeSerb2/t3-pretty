import type { ApprovalRequestId, ThreadSecretRequestResponse } from "@t3tools/contracts";
import { useState } from "react";
import { Pressable, View } from "react-native";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import type { PendingSecretRequest } from "../../lib/threadActivity";

export interface PendingSecretRequestCardProps {
  readonly request: PendingSecretRequest;
  readonly respondingRequestId: ApprovalRequestId | null;
  readonly onRespond: (
    requestId: ApprovalRequestId,
    response: ThreadSecretRequestResponse,
  ) => Promise<unknown>;
}

/**
 * An agent's API key prompt. The value goes over its own RPC into the secret
 * store, never through the composer or the event log.
 */
export function PendingSecretRequestCard(props: PendingSecretRequestCardProps) {
  const [value, setValue] = useState("");
  const trimmed = value.trim();
  const isResponding = props.respondingRequestId === props.request.requestId;
  const canSubmit = trimmed.length > 0 && !isResponding;
  const submit = () => {
    if (!canSubmit) return;
    void props.onRespond(props.request.requestId, { kind: "provided", value: trimmed });
  };
  // Opaque for the same reason as PendingUserInputCard: nothing blurs the feed
  // behind this card, so a translucent surface bleeds messages through it.
  return (
    <View className="gap-2.5 rounded-[20px] border border-border bg-card-alt p-4">
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
    </View>
  );
}
