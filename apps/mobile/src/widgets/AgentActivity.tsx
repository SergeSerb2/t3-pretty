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

  // Order attention-first so whatever needs the user floats to the top of every
  // presentation, then failures, then in-flight work, then finished/stale.
  const phasePriority = (phase: AgentActivityPhase): number => {
    if (phase === "waiting_for_approval" || phase === "waiting_for_input") return 0;
    if (phase === "failed") return 1;
    if (phase === "running" || phase === "starting") return 2;
    return 3;
  };
  const ordered = [...props.activities].sort(
    (a, b) => phasePriority(a.phase) - phasePriority(b.phase),
  );
  // Glass Live Activities have a tight height budget once the header and
  // elapsed time are on the card; three attention-first rows stay readable.
  const row0 = ordered[0];
  const row1 = ordered[1];
  const row2 = ordered[2];

  const attentionRows = props.activities.filter(
    (row) => row.phase === "waiting_for_approval" || row.phase === "waiting_for_input",
  );
  const attentionRow = attentionRows[0];
  const failedRow = props.activities.find((row) => row.phase === "failed");
  const heroRow = attentionRow ?? failedRow ?? row0;
  const tintColor = phaseTint(heroRow?.phase);
  // Headline count leans on the accent when a human is actually blocked.
  const headerTint = attentionRow
    ? phaseTint(attentionRow.phase)
    : failedRow
      ? phaseTint(failedRow.phase)
      : tintColor;

  // With nothing active the aggregate only carries recently finished work, so
  // "0 active agents" (and a lone "0" in the expanded island) read as broken.
  // Lead with the outcome instead. The outcome is derived here from the rows
  // rather than taken from the server subtitle (which keys off the newest
  // terminal row): every presentation — header text, tint, count slots,
  // minimal glyph — must agree, and a failure anywhere should dominate a
  // newer success.
  const allDone = props.activeCount === 0;
  const doneLabel = failedRow ? "Failed" : "Done";
  const outcomeLabel = failedRow ? "Agent work failed" : "Agent work completed";

  // Header copy: "5 active agents" + (", 1 needs attention"). The banner renders
  // the two parts in-line so the attention half can carry the accent color;
  // `summary` is the short form for tight spots (expanded center, watch card).
  const agentWord = props.activeCount === 1 ? "agent" : "agents";
  const agentsLabel = allDone ? outcomeLabel : `${props.activeCount} active ${agentWord}`;
  const attentionSuffix =
    attentionRows.length > 0
      ? `${attentionRows.length} need${attentionRows.length === 1 ? "s" : ""} attention`
      : "";
  const activeLabel = allDone ? doneLabel : `${props.activeCount} active`;
  const summary = attentionSuffix || activeLabel;

  // Any registered scheme variant routes back to this app; taps are delivered
  // to the widget's containing app, so the prod scheme is safe for all builds.
  const deepLinkRow = attentionRow ?? row0;
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

  // A scannable status glyph per phase — reads faster than colored words and
  // ties the compact / expanded / banner / watch presentations together.
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

  const renderProgressBar = (row: AgentActivityRowProps | undefined, color: string) =>
    typeof row?.progress === "number" ? (
      <ProgressView
        value={Math.max(0, Math.min(1, row.progress))}
        modifiers={[progressViewStyle("linear"), tint(color)]}
      />
    ) : null;

  // Single-line row used by every presentation: mark, title, inline project,
  // status. The status carries layoutPriority(1) so when space runs out it's
  // the title that truncates. Single-line keeps rows inside the expanded
  // island's hard height budget (~160pt).
  const renderCompactRow = (row: AgentActivityRowProps) => (
    <HStack spacing={8} alignment="center">
      {renderPhaseMark(row.phase, 14, phaseTint(row.phase))}
      <Text
        modifiers={[
          font({ design: "rounded", weight: "semibold", size: 13 }),
          foregroundStyle(primaryForeground),
          lineLimit(1),
        ]}
      >
        {row.threadTitle}
      </Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle(secondaryForeground), lineLimit(1)]}>
        {row.projectTitle}
      </Text>
      <Spacer minLength={8} />
      <Text
        modifiers={[
          font({ design: "rounded", weight: "semibold", size: 12 }),
          foregroundStyle(phaseTint(row.phase)),
          layoutPriority(1),
          lineLimit(1),
        ]}
      >
        {row.status}
      </Text>
    </HStack>
  );

  // The branded T3 mark. `assetName` resolves the template image set bundled in
  // the widget extension's asset catalog. Image views only honor `resizable`
  // directly (frame/foregroundStyle are dropped), so we size it via a container
  // frame the resizable image fills and tint it through the container's
  // foreground style, which the template image inherits. The 3:2 frame matches
  // the glyph's aspect ratio so it never distorts.
  const renderLogo = (height: number, color: string) => (
    <HStack modifiers={[frame({ width: height * 1.5, height }), foregroundStyle(color)]}>
      <Image assetName="T3Mark" modifiers={[resizable()]} />
    </HStack>
  );

  const bannerModifiers = [
    padding({ all: 16 }),
    // nil tint lets iOS 26 apply Liquid Glass instead of the old opaque
    // Live Activity material. Pre-glass iOS keeps the system default.
    activityBackgroundTint(null),
    ...(deepLink ? [widgetURL(deepLink)] : []),
  ];

  const header = (
    <HStack spacing={8} alignment="center">
      {renderLogo(14, primaryForeground)}
      <Text
        modifiers={[
          font({ design: "rounded", weight: "semibold", size: 13 }),
          foregroundStyle(allDone ? headerTint : primaryForeground),
          lineLimit(1),
        ]}
      >
        {agentsLabel}
      </Text>
      {attentionSuffix ? (
        <Text modifiers={[font({ size: 13 }), foregroundStyle(secondaryForeground)]}>·</Text>
      ) : null}
      {attentionSuffix ? (
        <Text
          modifiers={[
            font({ design: "rounded", weight: "semibold", size: 13 }),
            foregroundStyle(headerTint),
            lineLimit(1),
          ]}
        >
          {attentionSuffix}
        </Text>
      ) : null}
      <Spacer minLength={8} />
      {renderClock(12, secondaryForeground)}
    </HStack>
  );

  const bannerBody = simplified ? (
    header
  ) : (
    <VStack alignment="leading" spacing={10}>
      {header}
      {row0 ? renderCompactRow(row0) : null}
      {renderProgressBar(heroRow, tintColor)}
      {row1 ? renderCompactRow(row1) : null}
      {row2 ? renderCompactRow(row2) : null}
    </VStack>
  );

  return {
    banner: (
      <VStack alignment="leading" spacing={0} modifiers={bannerModifiers}>
        {bannerBody}
      </VStack>
    ),
    // Compact card for the watchOS Smart Stack + CarPlay (the `.small` family):
    // brand + count, then the single most important agent with its status glyph.
    bannerSmall: (
      <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 10 })]}>
        <HStack spacing={7} alignment="center">
          {renderLogo(14, primaryForeground)}
          <Text
            modifiers={[
              font({ design: "rounded", weight: "bold", size: 13 }),
              foregroundStyle(headerTint),
              lineLimit(1),
            ]}
          >
            {attentionRows.length > 0 ? summary : activeLabel}
          </Text>
          <Spacer minLength={6} />
        </HStack>
        {row0 ? (
          <HStack spacing={7} alignment="center">
            {renderPhaseMark(row0.phase, 12, phaseTint(row0.phase))}
            <Text
              modifiers={[
                font({ design: "rounded", weight: "semibold", size: 12 }),
                foregroundStyle(primaryForeground),
                lineLimit(1),
              ]}
            >
              {row0.threadTitle}
            </Text>
            <Spacer minLength={6} />
            <Text
              modifiers={[
                font({ design: "rounded", size: 11 }),
                foregroundStyle(phaseTint(row0.phase)),
              ]}
            >
              {row0.status}
            </Text>
          </HStack>
        ) : null}
      </VStack>
    ),
    compactLeading:
      heroRow && (heroInFlight || attentionRow || failedRow || allDone)
        ? renderPhaseMark(heroRow.phase, 20, tintColor)
        : renderLogo(14, tintColor),
    compactTrailing: (
      <Text
        modifiers={[
          font({ design: "rounded", weight: "semibold", size: 12 }),
          foregroundStyle(tintColor),
        ]}
      >
        {attentionRow
          ? attentionRow.phase === "waiting_for_approval"
            ? "Approval"
            : "Input"
          : activeLabel}
      </Text>
    ),
    // The shared/minimal form is a ~22pt circle — a single signal reads there,
    // the wordmark does not. Show the blocking/outcome phase mark, else the
    // mark (all-done shows the hero row's checkmark/cross).
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
          {allDone ? doneLabel : `${props.activeCount}`}
        </Text>
      </HStack>
    ),
    expandedCenter: null,
    expandedTrailing: renderClock(11, tintColor),
    expandedBottom: (
      // Vertical padding only: the expanded region provides its own horizontal
      // content margins, so `all` padding double-indented the rows.
      // Horizontal padding keeps both edges clear of the island's corner
      // curvature (right edge clipped status labels; titles hugged the left).
      <VStack
        alignment="leading"
        spacing={8}
        modifiers={
          deepLink
            ? [padding({ vertical: 4, horizontal: 8 }), widgetURL(deepLink)]
            : [padding({ vertical: 4, horizontal: 8 })]
        }
      >
        {row0 ? renderCompactRow(row0) : null}
        {renderProgressBar(heroRow, tintColor)}
        {row1 ? renderCompactRow(row1) : null}
        {row2 ? renderCompactRow(row2) : null}
      </VStack>
    ),
  };
}

export default createLiveActivity<AgentActivityProps>("AgentActivity", AgentActivity);
