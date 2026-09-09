import type {
  ApprovalRequestId,
  ProviderApprovalDecision,
  ProviderApprovalOption,
} from "@t3tools/contracts";
import { Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { cn } from "../../lib/cn";
import type { PendingApproval } from "../../lib/threadActivity";

export interface PendingApprovalCardProps {
  readonly approval: PendingApproval;
  readonly respondingApprovalId: ApprovalRequestId | null;
  readonly onRespond: (
    requestId: ApprovalRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<unknown>;
}

const DEFAULT_APPROVAL_OPTIONS: ReadonlyArray<ProviderApprovalOption> = [
  { decision: "accept", label: "Allow once" },
  { decision: "acceptForSession", label: "Allow session" },
  { decision: "decline", label: "Decline" },
];

export function PendingApprovalCard(props: PendingApprovalCardProps) {
  const responding = props.respondingApprovalId === props.approval.requestId;
  const options: ReadonlyArray<ProviderApprovalOption> =
    props.approval.options ?? DEFAULT_APPROVAL_OPTIONS;
  const warning = options.find((option) => option.warning)?.warning;
  // Opaque for the same reason as PendingUserInputCard: nothing blurs the feed
  // behind this card, so a translucent surface bleeds messages through it.
  return (
    <View className="gap-2.5 rounded-[20px] border border-border bg-card-alt p-4">
      <Text className="font-t3-bold text-2xs uppercase tracking-[1.1px] text-foreground-secondary">
        Approval needed
      </Text>
      <Text className="font-t3-bold text-lg text-foreground">
        {props.approval.appName ?? props.approval.requestKind}
      </Text>
      {props.approval.detail ? (
        <Text className="font-sans text-sm leading-normal text-foreground-secondary">
          {props.approval.detail}
        </Text>
      ) : null}
      {warning ? (
        <Text className="font-sans text-xs leading-normal text-warning-foreground">{warning}</Text>
      ) : null}
      {/* Dimming the row is the only sign a decision is in flight: the card
          stays mounted for the whole round trip, which is visible on relays. */}
      <View className={cn("flex-row flex-wrap gap-2.5", responding && "opacity-50")}>
        {options.map((option) => (
          <Pressable
            key={option.decision}
            className={cn(
              "items-center justify-center rounded-[14px] px-3.5 py-3 active:opacity-70",
              option.decision === "accept"
                ? "bg-primary"
                : option.decision === "decline"
                  ? "bg-adaptive-rose-100-500-a18"
                  : "bg-adaptive-neutral-200-800",
            )}
            disabled={responding}
            onPress={() => void props.onRespond(props.approval.requestId, option.decision)}
          >
            <Text
              className={cn(
                "text-sm",
                option.decision === "accept"
                  ? "font-t3-extrabold text-primary-foreground"
                  : option.decision === "decline"
                    ? "font-t3-bold text-adaptive-rose-700-300"
                    : "font-t3-bold text-adaptive-neutral-950-50",
              )}
            >
              {option.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
