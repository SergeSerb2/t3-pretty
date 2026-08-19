import type { PullRequestComment, PullRequestReviewThread } from "@t3tools/contracts";
import { formatGrokReviewLocation, parseGrokReviewFinding } from "@t3tools/shared/sourceControl";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";

import { SymbolView } from "../../components/AppSymbol";
import { AppText as Text } from "../../components/AppText";
import { EmptyState } from "../../components/EmptyState";
import { cn } from "../../lib/cn";
import { relativeTime } from "../../lib/time";
import { useThemeColor } from "../../lib/useThemeColor";
import { PullRequestActionChip, PullRequestChipRow } from "./PullRequestActionChip";
import { PullRequestActorAvatar } from "./PullRequestActorAvatar";
import {
  countUnresolvedReviewThreads,
  describePullRequestConversationSummary,
  type buildPullRequestTimeline,
  type composePullRequestDetailView,
  type groupPullRequestConversation,
} from "./pullRequestDetail.logic";
import { hasVisiblePullRequestBody } from "./pullRequestMarkdown.logic";
import { PullRequestMarkdown } from "./PullRequestMarkdown";
import { formatReviewState } from "./pullRequestPresentation";

type Detail = NonNullable<ReturnType<typeof composePullRequestDetailView>>;

export function PullRequestConversation(props: {
  readonly detail: Detail;
  readonly conversation: ReturnType<typeof groupPullRequestConversation>;
  readonly timeline: ReturnType<typeof buildPullRequestTimeline>;
  readonly busy: boolean;
  readonly onComment: () => void;
  readonly onReview: () => void;
  readonly canReview: boolean;
  readonly onReply: (threadId: string) => void;
  readonly onFixThread: (thread: PullRequestReviewThread) => void;
  readonly onToggleResolved: (
    thread: PullRequestReviewThread,
    resolved: boolean,
  ) => Promise<boolean>;
}) {
  const unresolved = countUnresolvedReviewThreads(props.detail.reviewThreads);
  const summary = describePullRequestConversationSummary({
    commentCount: props.detail.commentCount,
    unresolvedThreadCount: unresolved,
    resolvedThreadCount: props.detail.reviewThreads.length - unresolved,
  });
  const [pendingById, setPendingById] = useState<Readonly<Record<string, true>>>({});
  const [resolvedById, setResolvedById] = useState<Readonly<Record<string, boolean>>>({});

  const toggleResolved = async (thread: PullRequestReviewThread, resolved: boolean) => {
    if (pendingById[thread.id] !== undefined) return;
    setPendingById((current) => ({ ...current, [thread.id]: true }));
    try {
      const saved = await props.onToggleResolved(thread, resolved);
      if (saved) {
        setResolvedById((current) => ({ ...current, [thread.id]: resolved }));
      }
    } finally {
      setPendingById((current) => {
        const next = { ...current };
        delete next[thread.id];
        return next;
      });
    }
  };

  return (
    <View className="gap-3 pt-1">
      <View className="gap-2.5">
        <Text className="text-sm text-foreground-muted">{summary}</Text>
        {props.detail.viewerPermissions.comment || props.canReview ? (
          <PullRequestChipRow>
            {props.detail.viewerPermissions.comment ? (
              <PullRequestActionChip icon="text.bubble" label="Comment" onPress={props.onComment} />
            ) : null}
            {props.canReview ? (
              <PullRequestActionChip label="Review" onPress={props.onReview} variant="primary" />
            ) : null}
          </PullRequestChipRow>
        ) : null}
      </View>
      {props.conversation.length === 0 ? (
        <EmptyState
          variant="plain"
          title="No conversation yet"
          detail="Comments and review threads will appear here."
        />
      ) : (
        props.conversation.map((item) => {
          if (item.kind === "comment") {
            return <IssueCommentCard key={item.comment.id} comment={item.comment} />;
          }
          const override = resolvedById[item.thread.id];
          return (
            <ReviewThreadCard
              key={item.thread.id}
              busy={props.busy}
              canFix={!item.thread.isResolved && override !== true}
              canReply={
                props.detail.capabilities.review.reply && props.detail.viewerPermissions.comment
              }
              canResolve={
                props.detail.capabilities.review.resolve && props.detail.viewerPermissions.resolve
              }
              pending={pendingById[item.thread.id] === true}
              resolved={override ?? item.thread.isResolved}
              thread={item.thread}
              onFix={() => props.onFixThread(item.thread)}
              onReply={() => props.onReply(item.thread.id)}
              onToggleResolved={() =>
                void toggleResolved(item.thread, !(override ?? item.thread.isResolved))
              }
            />
          );
        })
      )}
      {props.detail.commentsTruncated ? (
        <Text className="text-xs text-foreground-muted">
          The host has more remarks than this page loaded. Open it on the host to read the rest.
        </Text>
      ) : null}
      {props.timeline.length > 0 ? (
        <Text className="pt-3 text-xs font-t3-medium uppercase tracking-[0.5px] text-foreground-muted">
          Timeline
        </Text>
      ) : null}
      {props.timeline.slice(0, 12).map((event) => (
        <View key={event.id} className="flex-row items-start gap-2.5 py-0.5">
          <Text className="w-14 pt-px text-2xs tabular-nums text-foreground-tertiary">
            {relativeTime(event.at)}
          </Text>
          <Text className="min-w-0 flex-1 text-sm leading-5 text-foreground">
            {event.actor?.login ? `${event.actor.login} ` : ""}
            {event.title}
            {event.body ? ` — ${event.body}` : ""}
          </Text>
        </View>
      ))}
    </View>
  );
}

function GrokFindingBody(props: { readonly body: string; readonly fallbackPath?: string | null }) {
  const grokFinding = parseGrokReviewFinding(props.body);
  const location = grokFinding
    ? formatGrokReviewLocation(grokFinding)
    : (props.fallbackPath ?? null);
  const markdown = grokFinding?.body ?? props.body;
  return (
    <>
      {grokFinding ? (
        <View className="mt-2.5 gap-1.5">
          {location ? (
            <Text className="font-mono text-2xs text-foreground-tertiary" numberOfLines={1}>
              {location}
            </Text>
          ) : null}
          <View className="flex-row items-start gap-2">
            <Text
              className={
                grokFinding.severity === "bug"
                  ? "text-2xs font-t3-bold uppercase text-danger-foreground"
                  : "text-2xs font-t3-bold uppercase text-foreground-muted"
              }
            >
              {grokFinding.severity}
            </Text>
            <Text className="min-w-0 flex-1 text-sm font-t3-bold text-foreground">
              {grokFinding.title}
            </Text>
          </View>
        </View>
      ) : location ? (
        <Text className="mt-2 font-mono text-2xs text-foreground-tertiary" numberOfLines={1}>
          {location}
        </Text>
      ) : null}
      {hasVisiblePullRequestBody(markdown) ? (
        <View className="mt-2.5">
          <PullRequestMarkdown density="comment" markdown={markdown} />
        </View>
      ) : null}
    </>
  );
}

function IssueCommentCard(props: { readonly comment: PullRequestComment }) {
  const reviewState = props.comment.reviewState
    ? formatReviewState(props.comment.reviewState)
    : null;
  return (
    <View className="rounded-2xl bg-card px-4 py-3.5">
      <CommentHeader
        actor={props.comment.author}
        createdAt={props.comment.createdAt}
        reviewState={reviewState}
      />
      <GrokFindingBody body={props.comment.body} fallbackPath={props.comment.path} />
    </View>
  );
}

function ReviewThreadCard(props: {
  readonly thread: PullRequestReviewThread;
  readonly resolved: boolean;
  readonly pending: boolean;
  readonly busy: boolean;
  readonly canReply: boolean;
  readonly canResolve: boolean;
  readonly canFix: boolean;
  readonly onReply: () => void;
  readonly onFix: () => void;
  readonly onToggleResolved: () => void;
}) {
  const muted = String(useThemeColor("--color-icon-subtle"));
  const [expanded, setExpanded] = useState(!props.resolved);
  const commentCount = props.thread.commentCount ?? props.thread.comments.length;

  useEffect(() => {
    setExpanded(!props.resolved);
  }, [props.resolved]);

  const location = `${props.thread.path}${props.thread.line === null ? "" : `:${props.thread.line}`}`;

  return (
    <View className="rounded-2xl bg-card px-4 py-3.5">
      <View className="flex-row items-start gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          hitSlop={6}
          onPress={() => setExpanded((current) => !current)}
          className="min-w-0 flex-1 flex-row items-start gap-2"
        >
          <View className="mt-0.5">
            <SymbolView
              name={props.resolved ? "checkmark.circle" : "text.bubble"}
              size={14}
              tintColor={props.resolved ? "#059669" : muted}
              type="monochrome"
            />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-t3-bold text-foreground">
              {props.resolved ? "Resolved" : "Open"} · {commentCount}{" "}
              {commentCount === 1 ? "comment" : "comments"}
            </Text>
            <Text className="mt-0.5 font-mono text-2xs text-foreground-tertiary" numberOfLines={1}>
              {location}
              {props.thread.isOutdated ? " · Outdated" : ""}
            </Text>
          </View>
          <SymbolView
            name={expanded ? "chevron.up" : "chevron.down"}
            size={11}
            tintColor={muted}
            type="monochrome"
          />
        </Pressable>
      </View>

      {expanded ? (
        <View className="mt-3 gap-3">
          {props.thread.comments.map((comment, index) => (
            <View key={comment.id} className={cn(index > 0 && "border-t border-border pt-3")}>
              <CommentHeader actor={comment.author} createdAt={comment.createdAt} />
              <GrokFindingBody
                body={comment.body}
                fallbackPath={index === 0 ? props.thread.path : null}
              />
            </View>
          ))}
        </View>
      ) : null}

      {props.canReply || props.canResolve || (props.canFix && !props.resolved) ? (
        <View className="mt-3">
          <PullRequestChipRow>
            {props.canReply ? (
              <PullRequestActionChip disabled={props.busy} label="Reply" onPress={props.onReply} />
            ) : null}
            {props.canResolve ? (
              <PullRequestActionChip
                accessibilityLabel={
                  props.resolved ? "Unresolve this conversation" : "Resolve this conversation"
                }
                disabled={props.busy}
                label={props.resolved ? "Unresolve" : "Resolve"}
                loading={props.pending}
                loadingLabel={props.resolved ? "Unresolving…" : "Resolving…"}
                onPress={props.onToggleResolved}
                variant={props.resolved ? "quiet" : "resolve"}
              />
            ) : null}
            {props.canFix && !props.resolved ? (
              <PullRequestActionChip
                disabled={props.busy}
                icon="hammer"
                label="Fix in a thread"
                onPress={props.onFix}
              />
            ) : null}
          </PullRequestChipRow>
        </View>
      ) : null}
    </View>
  );
}

function CommentHeader(props: {
  readonly actor: PullRequestComment["author"];
  readonly createdAt: string;
  readonly reviewState?: string | null;
}) {
  const login = props.actor?.login ?? "ghost";
  return (
    <View className="flex-row items-center gap-2.5">
      <PullRequestActorAvatar actor={props.actor} size={26} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="min-w-0 shrink text-sm font-t3-bold text-foreground" numberOfLines={1}>
            {login}
          </Text>
          <Text className="shrink-0 text-2xs text-foreground-tertiary">
            {relativeTime(props.createdAt)}
          </Text>
        </View>
        {props.reviewState ? (
          <Text className="text-2xs font-t3-medium text-foreground-muted">{props.reviewState}</Text>
        ) : null}
      </View>
    </View>
  );
}
