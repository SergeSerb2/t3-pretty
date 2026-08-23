import { HStack, Image, ProgressView, Spacer, Text, VStack } from "@expo/ui/swift-ui";
import type { ComponentProps } from "react";
import {
  activityBackgroundTint,
  font,
  foregroundStyle,
  frame,
  layoutPriority,
  lineLimit,
  padding,
  progressViewStyle,
  resizable,
  tint,
  widgetURL,
} from "@expo/ui/swift-ui/modifiers";
import {
  createLiveActivity,
  type LiveActivityComponent,
  type LiveActivityLayout,
} from "expo-widgets";

type LiveActivityEnvironment = Parameters<LiveActivityComponent<AgentActivityProps>>[1];

export type AgentActivityPhase =
  | "starting"
  | "running"
  | "waiting_for_approval"
  | "waiting_for_input"
  | "completed"
  | "failed"
  | "stale";

export interface AgentActivityRowProps {
  readonly environmentId: string;
  readonly threadId: string;
  readonly projectTitle: string;
  readonly threadTitle: string;
  readonly modelTitle: string;
  readonly phase: AgentActivityPhase;
  readonly status: string;
  readonly updatedAt: string;
  readonly deepLink: string;
  readonly progress?: number;
  // When the in-flight turn started; drives the ticking elapsed timer.
  readonly startedAt?: string;
}

export interface AgentActivityProps {
  readonly title: string;
  readonly subtitle: string;
  readonly activeCount: number;
  readonly updatedAt: string;
  readonly activities: ReadonlyArray<AgentActivityRowProps>;
}

// This function is serialized into the widget extension's JS bundle, so it
// must stay self-contained: no references to module-scope helpers, only the
// imported view/modifier factories.
export function AgentActivity(
  props: AgentActivityProps,
  environment: LiveActivityEnvironment,
): LiveActivityLayout {
  "widget";

  // Use SwiftUI's semantic label colors rather than fixed hex keyed off the
  // device color scheme. A Live Activity banner always renders over a dark
  // system material regardless of the device's light/dark setting, so
  // scheme-derived dark text read as unreadable dark-on-dark on the lock
  // screen. Semantic colors adapt to whatever material the OS places them on:
  // the dark LA banner, iOS 26 liquid glass, and the (light or dark)
  // home-screen widget alike.
  const primaryForeground = "primary";
  const secondaryForeground = "secondary";

  // Status tints mirror the web sidebar's pills
  // (apps/web/src/components/Sidebar.logic.ts resolveThreadStatusPill): amber
  // for approval, indigo for input, sky for working, emerald for completed.
  // On iPhone the LA sits on a dark material, but macOS (iPhone Mirroring /
  // Mac notification center) renders it on a light one — so pick the web
  // palette's light (-600) or dark (-300) variant off the color scheme.
  const isLightScheme = environment.colorScheme === "light";
  const phaseTint = (phase: AgentActivityPhase | undefined): string => {
    if (environment.isLuminanceReduced) {
      return secondaryForeground;
    }
    switch (phase) {
      case "waiting_for_approval":
        return isLightScheme ? "#d97706" : "#fcd34d"; // amber-600 / amber-300
      case "waiting_for_input":
        return isLightScheme ? "#4f46e5" : "#a5b4fc"; // indigo-600 / indigo-300
      case "failed":
        return isLightScheme ? "#dc2626" : "#fca5a5"; // red-600 / red-300
      case "completed":
        return isLightScheme ? "#059669" : "#6ee7b7"; // emerald-600 / emerald-300
      case "starting":
      case "running":
      default:
        return isLightScheme ? "#0284c7" : "#7dd3fc"; // sky-600 / sky-300
    }
  };

  // Order attention-first so the hero row (deep link, island glyph, timer)
  // is whatever the user should open, then failures, then in-flight work.
  const phasePriority = (phase: AgentActivityPhase): number => {
    if (phase === "waiting_for_approval" || phase === "waiting_for_input") return 0;
    if (phase === "failed") return 1;
    if (phase === "running" || phase === "starting") return 2;
    return 3;
  };
  const ordered = [...props.activities].sort(
    (a, b) => phasePriority(a.phase) - phasePriority(b.phase),
  );
  const heroRow = ordered[0];

  const approvalRows = props.activities.filter((row) => row.phase === "waiting_for_approval");
  const inputRows = props.activities.filter((row) => row.phase === "waiting_for_input");
  const attentionRows = props.activities.filter(
    (row) => row.phase === "waiting_for_approval" || row.phase === "waiting_for_input",
  );
  const attentionRow = ordered.find(
    (row) => row.phase === "waiting_for_approval" || row.phase === "waiting_for_input",
  );
  const failedRows = props.activities.filter((row) => row.phase === "failed");
  const failedRow = failedRows[0];
  const tintColor = phaseTint(attentionRow?.phase ?? failedRow?.phase ?? heroRow?.phase);
  const headerTint = attentionRow
    ? phaseTint(attentionRow.phase)
    : failedRow
      ? phaseTint(failedRow.phase)
      : tintColor;

  // With nothing active the aggregate only carries recently finished work, so
  // "0 working" reads as broken. Lead with the outcome instead. The outcome
  // is derived here from the rows rather than taken from the server subtitle
  // (which keys off the newest terminal row): every presentation — header,
  // tint, count slots, minimal glyph — must agree, and a failure anywhere
  // should dominate a newer success.
  const allDone = props.activeCount === 0;
  const doneLabel = failedRow ? "Failed" : "Done";
  const workingCount = allDone ? 0 : Math.max(0, props.activeCount - attentionRows.length);
  const failedCount = allDone ? 0 : failedRows.length;

  const attentionLabel =
    attentionRows.length === 0
      ? ""
      : approvalRows.length > 0 && inputRows.length === 0
        ? `${approvalRows.length} ${approvalRows.length === 1 ? "approval" : "approvals"}`
        : inputRows.length > 0 && approvalRows.length === 0
          ? `${inputRows.length} ${inputRows.length === 1 ? "input" : "inputs"}`
          : `${attentionRows.length} need you`;
  const workingLabel = workingCount > 0 ? `${workingCount} working` : "";
  const failedLabel = failedCount > 0 ? `${failedCount} failed` : "";
  // One summary line, attention first: "1 approval · 2 working · 1 failed".
  const glanceParts = allDone
    ? [doneLabel]
    : [attentionLabel, workingLabel, failedLabel].filter((part) => part !== "");
  const glance = glanceParts.length > 0 ? glanceParts.join(" · ") : doneLabel;
  const compactTrailingLabel = allDone
    ? doneLabel
    : attentionRow
      ? attentionRows.length > 1
        ? `${attentionRows.length}`
        : attentionRow.phase === "waiting_for_approval"
          ? "Approval"
          : "Input"
      : `${workingCount}`;

  // Any registered scheme variant routes back to this app; taps are delivered
  // to the widget's containing app, so the prod scheme is safe for all builds.
  const deepLinkRow = attentionRow ?? heroRow;
  const deepLink =
    deepLinkRow && deepLinkRow.deepLink.startsWith("/") && !deepLinkRow.deepLink.startsWith("//")
      ? `t3code://${deepLinkRow.deepLink.slice(1)}`
      : null;

  const inFlightPhase = (phase: AgentActivityPhase | undefined): boolean =>
    phase === "running" || phase === "starting";
  const heroInFlight = inFlightPhase(heroRow?.phase) && !allDone;
  const allowMotion = !environment.isLuminanceReduced;
  const simplified = environment.levelOfDetail === "simplified";

  const parseDate = (value: string | undefined): Date | null => {
    if (!value) {
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const clockDate = parseDate(heroRow?.updatedAt ?? props.updatedAt);

  type SFName = NonNullable<ComponentProps<typeof Image>["systemName"]>;
  const phaseSymbol = (phase: AgentActivityPhase): SFName => {
    switch (phase) {
      case "waiting_for_approval":
        return "exclamationmark.circle.fill";
      case "waiting_for_input":
        return "questionmark.circle.fill";
      case "failed":
        return "xmark.octagon.fill";
      case "completed":
        return "checkmark.circle.fill";
      case "starting":
        return "circle.dotted";
      case "stale":
        return "clock.arrow.circlepath";
      case "running":
      default:
        return "arrow.triangle.2.circlepath";
    }
  };

  // SF Symbols, like the logo, ignore frame/foregroundStyle applied directly to
  // the image; size + tint them through a container the resizable symbol fills.
  const renderGlyph = (systemName: SFName, size: number, color: string) => (
    <HStack modifiers={[frame({ width: size, height: size }), foregroundStyle(color)]}>
      <Image systemName={systemName} modifiers={[resizable()]} />
    </HStack>
  );

  // Live Activities cannot run JS timers. A circular ProgressView is the
  // system-native in-flight mark — the SF Symbol it replaced was a still
  // frame, which is why the island looked frozen.
  const renderPhaseMark = (phase: AgentActivityPhase, size: number, color: string) =>
    inFlightPhase(phase) && allowMotion ? (
      <ProgressView
        modifiers={[
          progressViewStyle("circular"),
          tint(color),
          frame({ width: size, height: size }),
        ]}
      />
    ) : (
      renderGlyph(phaseSymbol(phase), size, color)
    );

  // Relative dates keep ticking on the lock screen without a push update.
  const renderClock = (size: number, color: string) =>
    clockDate ? (
      <Text
        date={clockDate}
        dateStyle="relative"
        modifiers={[
          font({ design: "rounded", weight: "semibold", size }),
          foregroundStyle(color),
          layoutPriority(1),
          lineLimit(1),
        ]}
      />
    ) : null;

  // Per-row live time: an elapsed timer for in-flight work (ticks every
  // second without a push — the card never looks frozen), a relative age for
  // everything else (how long an approval sat, how long ago work finished).
  const renderRowTime = (row: AgentActivityRowProps, size: number, color: string) => {
    const timerDate = inFlightPhase(row.phase) ? parseDate(row.startedAt) : null;
    const relativeDate = timerDate ?? parseDate(row.updatedAt);
    return relativeDate ? (
      <Text
        date={relativeDate}
        dateStyle={timerDate ? "timer" : "relative"}
        modifiers={[
          font({ design: "rounded", weight: "semibold", size }),
          foregroundStyle(color),
          layoutPriority(1),
          lineLimit(1),
        ]}
      />
    ) : null;
  };

  const renderProgressBar = (row: AgentActivityRowProps | undefined, color: string) =>
    typeof row?.progress === "number" ? (
      <ProgressView
        value={Math.max(0, Math.min(1, row.progress))}
        modifiers={[progressViewStyle("linear"), tint(color)]}
      />
    ) : null;

  // One thread, one line: phase mark, title, status (plan step for running
  // work), and the live time on the right. The title wins the space fight;
  // the status truncates first.
  const renderActivityRow = (row: AgentActivityRowProps) => (
    <HStack key={`${row.environmentId}:${row.threadId}`} spacing={6} alignment="center">
      {renderPhaseMark(row.phase, 12, phaseTint(row.phase))}
      <Text
        modifiers={[
          font({ design: "rounded", weight: "semibold", size: 14 }),
          foregroundStyle(primaryForeground),
          lineLimit(1),
          layoutPriority(1),
        ]}
      >
        {row.threadTitle}
      </Text>
      {row.status ? (
        <Text
          modifiers={[
            font({ design: "rounded", weight: "regular", size: 12 }),
            foregroundStyle(secondaryForeground),
            lineLimit(1),
          ]}
        >
          {row.status}
        </Text>
      ) : null}
      <Spacer minLength={6} />
      {renderRowTime(row, 11, secondaryForeground)}
    </HStack>
  );

  // The banner lists up to three rows; leftover live work collapses into
  // one "+N more" line. Terminal rows ride along in the payload but must
  // not inflate overflow past what the header calls working. activeCount
  // can still exceed delivered rows (payload caps at 5).
  const MAX_BANNER_ROWS = 3;
  const shownRows = ordered.slice(0, MAX_BANNER_ROWS);
  const shownLive = shownRows.filter(
    (row) => row.phase !== "completed" && row.phase !== "failed",
  ).length;
  const overflowCount = Math.max(0, props.activeCount - shownLive);
  const renderOverflow = () =>
    overflowCount > 0 ? (
      <Text
        modifiers={[
          font({ design: "rounded", weight: "semibold", size: 12 }),
          foregroundStyle(secondaryForeground),
          lineLimit(1),
        ]}
      >
        {`+${overflowCount} more`}
      </Text>
    ) : null;

  // A single thread gets the hero treatment: big title, status line, progress.
  const soloRow = props.activities.length === 1 && overflowCount === 0 ? heroRow : undefined;

  const renderGlanceLine = (size: number) => (
    <Text
      modifiers={[
        font({ design: "rounded", weight: "bold", size }),
        foregroundStyle(headerTint),
        lineLimit(1),
      ]}
    >
      {glance}
    </Text>
  );

  // The branded T3 mark. `assetName` resolves the template image set bundled in
  // the widget extension's asset catalog. Image views only honor `resizable`
  // directly (frame/foregroundStyle are dropped), so we size it via a container
  // frame the resizable image fills and tint it through the container's
  // foreground style, which the template image inherits. The frame matches
  // the cut-out T3's aspect ratio so it never distorts.
  const renderLogo = (height: number, color: string) => (
    <HStack modifiers={[frame({ width: height * (480 / 351), height }), foregroundStyle(color)]}>
      <Image assetName="T3Mark" modifiers={[resizable()]} />
    </HStack>
  );

  const bannerModifiers = [
    padding({ all: 14 }),
    // nil tint lets iOS 26 apply Liquid Glass instead of the old opaque
    // Live Activity material. Pre-glass iOS keeps the system default.
    activityBackgroundTint(null),
    ...(deepLink ? [widgetURL(deepLink)] : []),
  ];

  const header = (
    <HStack spacing={8} alignment="center">
      {renderLogo(13, primaryForeground)}
      {renderGlanceLine(13)}
      <Spacer minLength={8} />
      {renderClock(11, secondaryForeground)}
    </HStack>
  );

  const bannerBody = simplified ? (
    <HStack spacing={8} alignment="center">
      {renderLogo(14, primaryForeground)}
      {renderGlanceLine(17)}
      <Spacer minLength={8} />
      {renderClock(12, secondaryForeground)}
    </HStack>
  ) : soloRow ? (
    <VStack alignment="leading" spacing={6}>
      {header}
      <HStack spacing={7} alignment="center">
        {renderPhaseMark(soloRow.phase, 16, phaseTint(soloRow.phase))}
        <Text
          modifiers={[
            font({ design: "rounded", weight: "bold", size: 17 }),
            foregroundStyle(primaryForeground),
            lineLimit(2),
            layoutPriority(1),
          ]}
        >
          {soloRow.threadTitle}
        </Text>
        <Spacer minLength={6} />
        {renderRowTime(soloRow, 13, phaseTint(soloRow.phase))}
      </HStack>
      {soloRow.status ? (
        <Text
          modifiers={[
            font({ design: "rounded", weight: "semibold", size: 13 }),
            foregroundStyle(secondaryForeground),
            lineLimit(1),
          ]}
        >
          {soloRow.status}
        </Text>
      ) : null}
      {renderProgressBar(soloRow, phaseTint(soloRow.phase))}
    </VStack>
  ) : (
    <VStack alignment="leading" spacing={7}>
      {header}
      {shownRows.map((row) => renderActivityRow(row))}
      {renderOverflow()}
    </VStack>
  );

  return {
    banner: (
      <VStack alignment="leading" spacing={0} modifiers={bannerModifiers}>
        {bannerBody}
      </VStack>
    ),
    // Compact card for the watchOS Smart Stack + CarPlay (the `.small` family):
    // brand + the one number that matters, plus the hero title when there is
    // exactly one thread to talk about.
    bannerSmall: (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 10 })]}>
        {renderLogo(14, primaryForeground)}
        {renderGlanceLine(20)}
        {soloRow ? (
          <Text
            modifiers={[
              font({ design: "rounded", weight: "semibold", size: 13 }),
              foregroundStyle(secondaryForeground),
              lineLimit(1),
            ]}
          >
            {soloRow.threadTitle}
          </Text>
        ) : null}
      </VStack>
    ),
    compactLeading:
      heroRow && (heroInFlight || attentionRow || failedRow || allDone)
        ? renderPhaseMark(heroRow.phase, 20, tintColor)
        : renderLogo(14, tintColor),
    // A lone in-flight thread shows its live elapsed timer in the island —
    // the strongest "still alive" signal a glance can carry. Everything else
    // shows the count/blocking label.
    compactTrailing:
      soloRow && inFlightPhase(soloRow.phase) && parseDate(soloRow.startedAt) ? (
        <Text
          date={parseDate(soloRow.startedAt) as Date}
          dateStyle="timer"
          modifiers={[
            font({ design: "rounded", weight: "semibold", size: 12 }),
            foregroundStyle(tintColor),
            lineLimit(1),
          ]}
        />
      ) : (
        <Text
          modifiers={[
            font({ design: "rounded", weight: "semibold", size: 12 }),
            foregroundStyle(tintColor),
          ]}
        >
          {compactTrailingLabel}
        </Text>
      ),
    // The shared/minimal form is a ~22pt circle — a single signal reads there,
    // the wordmark does not. Show the blocking/outcome phase mark, else the
    // in-flight mark (all-done shows the hero row's checkmark/cross).
    minimal:
      (attentionRow || failedRow || allDone) && heroRow
        ? renderPhaseMark(heroRow.phase, 13, phaseTint(heroRow.phase))
        : heroInFlight && heroRow
          ? renderPhaseMark(heroRow.phase, 13, tintColor)
          : renderLogo(11, tintColor),
    expandedLeading: (
      <HStack spacing={5} alignment="center" modifiers={[padding({ leading: 4, vertical: 4 })]}>
        {heroInFlight && heroRow
          ? renderPhaseMark(heroRow.phase, 16, tintColor)
          : renderLogo(15, tintColor)}
        <Text
          modifiers={[
            font({ design: "rounded", weight: "bold", size: 13 }),
            foregroundStyle(tintColor),
          ]}
        >
          {allDone
            ? doneLabel
            : attentionRows.length > 0
              ? `${attentionRows.length}`
              : `${workingCount}`}
        </Text>
      </HStack>
    ),
    expandedCenter: null,
    expandedTrailing:
      heroRow && inFlightPhase(heroRow.phase) && parseDate(heroRow.startedAt) ? (
        <Text
          date={parseDate(heroRow.startedAt) as Date}
          dateStyle="timer"
          modifiers={[
            font({ design: "rounded", weight: "semibold", size: 11 }),
            foregroundStyle(tintColor),
            lineLimit(1),
          ]}
        />
      ) : (
        renderClock(11, tintColor)
      ),
    expandedBottom: (
      // Vertical padding only: the expanded region provides its own horizontal
      // content margins, so `all` padding double-indented the content.
      // Horizontal padding keeps both edges clear of the island's corner
      // curvature.
      <VStack
        alignment="leading"
        spacing={6}
        modifiers={
          deepLink
            ? [padding({ vertical: 4, horizontal: 8 }), widgetURL(deepLink)]
            : [padding({ vertical: 4, horizontal: 8 })]
        }
      >
        {shownRows.map((row) => renderActivityRow(row))}
        {renderOverflow()}
        {soloRow ? renderProgressBar(soloRow, phaseTint(soloRow.phase)) : null}
      </VStack>
    ),
  };
}

function createAgentActivityFactory() {
  try {
    return createLiveActivity<AgentActivityProps>("AgentActivity", AgentActivity);
  } catch {
    // Widget registration talks to the expo-widgets native module. A missing
    // or mismatched factory must not abort the main app before the first
    // screen mounts — Live Activities degrade to a no-op instead.
    return {
      start() {
        throw new Error("Live Activities are unavailable.");
      },
      getInstances() {
        return [];
      },
    } as ReturnType<typeof createLiveActivity<AgentActivityProps>>;
  }
}

export default createAgentActivityFactory();
