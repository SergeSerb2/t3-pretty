import { useAtomSet } from "@effect/atom-react";
import {
  StackActions,
  useFocusEffect,
  useIsFocused,
  useNavigation,
} from "@react-navigation/native";
import {
  isAtomCommandInterrupted,
  reportAtomCommandResult,
  settleAsyncResult,
  settlePromise,
} from "@t3tools/client-runtime/state/runtime";
import * as Effect from "effect/Effect";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { BackHandler, Pressable, ScrollView, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { MaterialButton } from "../../components/MaterialButton";
import { T3Wordmark } from "../../components/T3Wordmark";
import { enterFadeUp } from "../../lib/motion";
import { runtime } from "../../lib/runtime";
import { updateMobilePreferencesAtom } from "../../state/preferences";
import { useWorkspaceEnvironments } from "../../state/workspace";
import { supportsAgentAwarenessPush } from "../agent-awareness/capabilities";
import { requestAgentNotificationPermission } from "../agent-awareness/notificationPermissions";
import { refreshAgentAwarenessRegistration } from "../agent-awareness/remoteRegistration";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { SceneryBackdrop } from "../scenery/SceneryBackdrop";
import {
  TRAILHEAD_WAYPOINTS,
  trailheadKicker,
  trailheadStepAfter,
  trailheadStepBefore,
  trailheadStepIndex,
  type TrailheadStepId,
} from "./trailhead.logic";
import { TrailheadRidge } from "./TrailheadRidge";

/** Beat between "Connected to …" appearing and the climb continuing. */
const AUTO_ADVANCE_MS = 900;

function lightImpact() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
}

function successNotice() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
}

/**
 * First-run setup drawn as a climb along one ridge: welcome, pair a computer,
 * allow notifications, summit. Pairing opens as a sheet above this route, so
 * the screen stays mounted and moves on by itself once a connection lands.
 */
export function TrailheadRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const environments = useWorkspaceEnvironments();
  const firstEnvironment = environments[0] ?? null;
  const hasConnections = firstEnvironment !== null;
  const cloudAvailable = hasCloudPublicConfig();
  const notifyAvailable = cloudAvailable && supportsAgentAwarenessPush();

  const [requestedStep, setRequestedStep] = useState<TrailheadStepId>("welcome");
  const [notificationsGranted, setNotificationsGranted] = useState(false);
  const [requestingNotifications, setRequestingNotifications] = useState(false);
  const [justPaired, setJustPaired] = useState(false);
  const skipNotify = !notifyAvailable || notificationsGranted;
  // The permission check can resolve after the ridge was reached; it is
  // stepped over either way.
  const step = requestedStep === "notify" && skipNotify ? "summit" : requestedStep;
  const autoAdvancing = justPaired && step === "connect";

  const goTo = useCallback(
    (requested: TrailheadStepId) => {
      const next = requested === "notify" && skipNotify ? "summit" : requested;
      setJustPaired(false);
      if (next === step) return;
      if (trailheadStepIndex(next) > trailheadStepIndex(step)) {
        if (next === "summit") successNotice();
        else lightImpact();
      }
      setRequestedStep(next);
    },
    [skipNotify, step],
  );
  const advance = useCallback(
    () => goTo(trailheadStepAfter(step, { skipNotify })),
    [goTo, skipNotify, step],
  );

  const finish = useCallback(() => {
    savePreferences({ onboardingCompletedAt: new Date().toISOString() });
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(StackActions.replace("Home"));
  }, [navigation, savePreferences]);

  // Already-granted permission makes the ridge stop a no-op.
  useEffect(() => {
    if (!notifyAvailable) return;
    let cancelled = false;
    void settlePromise(() => Notifications.getPermissionsAsync()).then((result) => {
      if (!cancelled && result._tag === "Success" && result.value.granted) {
        setNotificationsGranted(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [notifyAvailable]);

  // A connection appearing while base camp is open is the pairing finishing.
  const hadConnectionsRef = useRef(hasConnections);
  useEffect(() => {
    const had = hadConnectionsRef.current;
    hadConnectionsRef.current = hasConnections;
    if (!had && hasConnections && step === "connect") {
      successNotice();
      setJustPaired(true);
    }
  }, [hasConnections, step]);

  // Wait until the pairing sheet is gone so the confirmation is actually seen.
  useEffect(() => {
    if (!autoAdvancing || !isFocused) return;
    const timer = setTimeout(
      () => goTo(trailheadStepAfter("connect", { skipNotify })),
      AUTO_ADVANCE_MS,
    );
    return () => clearTimeout(timer);
  }, [autoAdvancing, goTo, isFocused, skipNotify]);

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        const previous = trailheadStepBefore(step, { skipNotify });
        if (previous !== null) goTo(previous);
        return true;
      });
      return () => subscription.remove();
    }, [goTo, skipNotify, step]),
  );

  const requestNotifications = useCallback(async () => {
    setRequestingNotifications(true);
    const result = await settleAsyncResult(() =>
      runtime.runPromiseExit(
        requestAgentNotificationPermission.pipe(
          Effect.tap((permission) =>
            permission.type === "granted" ? refreshAgentAwarenessRegistration() : Effect.void,
          ),
        ),
      ),
    );
    setRequestingNotifications(false);
    if (result._tag === "Success" && result.value.type === "granted") {
      setNotificationsGranted(true);
    } else if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      reportAtomCommandResult(result, { label: "trailhead notification permission" });
    }
    // Every outcome moves on; Settings → Notifications covers a later change of mind.
    goTo("summit");
  }, [goTo]);

  const environmentLabel = firstEnvironment?.environmentLabel ?? null;

  let content: ReactNode;
  let actions: ReactNode;
  switch (step) {
    case "welcome":
      content = (
        <StepCopy
          step={step}
          lead={
            <View className="mb-8 flex-row items-center gap-1.5">
              <T3Wordmark height={20} />
              <Text className="font-t3-medium text-foreground-muted text-[26px] tracking-[-0.6px]">
                Pretty
              </Text>
            </View>
          }
          title="Your agents, in your pocket."
          body="T3 Pretty steers the agents running on your computers. Let's rope one in."
        />
      );
      actions = (
        <MaterialButton fullWidth tone="primary" label="Start the climb" onPress={advance} />
      );
      break;
    case "connect":
      content = (
        <StepCopy
          step={step}
          title={hasConnections ? "Roped in." : "Pair a computer."}
          body={
            hasConnections
              ? "This phone can reach your computer now."
              : "Open T3 Pretty on your computer and go to Settings → Connections to show a pairing code. Or run this in a terminal there:"
          }
        >
          {hasConnections ? (
            <View className="mt-5 flex-row items-center gap-2.5">
              <View className="size-2 rounded-full bg-primary" />
              <Text className="flex-1 font-t3-medium text-base text-foreground" numberOfLines={2}>
                Connected to {environmentLabel}
              </Text>
            </View>
          ) : (
            <View className="mt-4 self-start rounded-[10px] border border-border bg-foreground/5 px-3 py-2">
              <Text selectable className="font-mono text-sm text-foreground">
                npx t3 pair
              </Text>
            </View>
          )}
        </StepCopy>
      );
      actions = hasConnections ? (
        <MaterialButton
          fullWidth
          tone="primary"
          label="Continue"
          disabled={autoAdvancing}
          onPress={advance}
        />
      ) : (
        <>
          <MaterialButton
            fullWidth
            tone="primary"
            label="Scan pairing code"
            onPress={() => navigation.navigate("ConnectionsNew", { mode: "scan_qr" })}
          />
          <MaterialButton
            fullWidth
            tone="text"
            label="Enter it by hand"
            onPress={() => navigation.navigate("ConnectionsNew")}
          />
          {cloudAvailable ? (
            <MaterialButton
              fullWidth
              tone="text"
              label="Sign in to T3 Connect"
              onPress={() => navigation.navigate("SettingsSheet", { screen: "SettingsAuth" })}
            />
          ) : null}
        </>
      );
      break;
    case "notify":
      content = (
        <StepCopy
          step={step}
          title="Know when an agent needs you."
          body="Get a nudge when a turn finishes, a plan wants approval, or an agent has a question. Nothing else."
        />
      );
      actions = (
        <>
          <MaterialButton
            fullWidth
            tone="primary"
            label="Allow notifications"
            loading={requestingNotifications}
            onPress={() => void requestNotifications()}
          />
          <MaterialButton
            fullWidth
            tone="text"
            label="Not now"
            disabled={requestingNotifications}
            onPress={() => goTo("summit")}
          />
        </>
      );
      break;
    case "summit":
      content = (
        <StepCopy
          step={step}
          title="Summit."
          body={
            environmentLabel !== null
              ? `Connected to ${environmentLabel}. Start a thread whenever you're ready.`
              : "You can pair a computer any time from Settings."
          }
        />
      );
      actions = (
        <MaterialButton fullWidth tone="primary" label="Start exploring" onPress={finish} />
      );
      break;
  }

  return (
    <View className="flex-1 bg-screen">
      <SceneryBackdrop threadKey={null} />
      <View
        className="flex-row justify-end px-3"
        style={{ paddingTop: insets.top, minHeight: insets.top + 44 }}
      >
        {step !== "summit" ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Skip setup"
            hitSlop={8}
            onPress={finish}
            className="min-h-11 justify-center px-3 active:opacity-60"
          >
            <Text className="font-t3-medium text-sm text-foreground-muted">Skip</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        className="flex-1"
        contentContainerClassName="grow px-7 pt-6 pb-4"
        showsVerticalScrollIndicator={false}
      >
        <Animated.View key={step} entering={enterFadeUp} className="w-full max-w-[460px]">
          {content}
        </Animated.View>
      </ScrollView>
      <Animated.View
        key={`${step}-actions`}
        entering={enterFadeUp}
        className="w-full max-w-[460px] gap-1 self-center px-6 pb-5"
      >
        {actions}
      </Animated.View>
      <TrailheadRidge
        waypoints={TRAILHEAD_WAYPOINTS}
        current={step}
        canSelect={(id) => !(id === "notify" && skipNotify)}
        onSelect={goTo}
      />
      {/* Continue the ridge's ground under the home indicator. */}
      <View className="bg-foreground/5" style={{ height: insets.bottom }} />
    </View>
  );
}

function StepCopy(props: {
  readonly step: TrailheadStepId;
  readonly lead?: ReactNode;
  readonly title: string;
  readonly body: string;
  readonly children?: ReactNode;
}) {
  return (
    <View>
      {props.lead}
      <Text className="font-mono text-2xs uppercase tracking-[1.6px] text-foreground-tertiary">
        {trailheadKicker(props.step)}
      </Text>
      <Text
        role="heading"
        className="mt-3 font-t3-bold text-[34px] leading-[40px] tracking-[-0.8px] text-foreground"
      >
        {props.title}
      </Text>
      <Text className="mt-3 text-base leading-[24px] text-foreground-muted">{props.body}</Text>
      {props.children}
    </View>
  );
}
