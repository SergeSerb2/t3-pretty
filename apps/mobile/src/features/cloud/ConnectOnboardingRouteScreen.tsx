import { NativeHeaderToolbar } from "../../native/StackHeader";
import { useAuth } from "@clerk/expo";
import { StackActions, useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { reportAtomCommandResult, settlePromise } from "@t3tools/client-runtime/state/runtime";
import { SURGE_CODE_ACCOUNT_NAME, SURGE_CONNECT_NAME } from "@t3tools/shared/connectBranding";
import { AndroidSheetHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { CloudEnvironmentRows } from "../connection/CloudEnvironmentRows";
import { splitEnvironmentSections } from "../connection/environmentSections";
import { useConnectionController } from "../connection/useConnectionController";
import { optOutOfConnectOnboarding } from "./connectOnboardingOptOut";
import { hasCloudPublicConfig } from "./publicConfig";

/**
 * Post-sign-in onboarding sheet for Surge Connect. Mobile never publishes
 * environments itself — it consumes ones published elsewhere — so this simply
 * surfaces the account's Surge Connect environments right after sign-in so every
 * device can be connected in one go. It shows on every sign-in: sign-out
 * clears the connected environments, so each new session starts from zero.
 */
export function ConnectOnboardingRouteScreen() {
  const navigation = useNavigation();

  // The route is deep-linkable; without cloud config the sheet would present
  // empty with no chrome to dismiss it, so bail back out instead.
  useEffect(() => {
    if (hasCloudPublicConfig()) {
      return;
    }
    if (navigation.canGoBack()) {
      navigation.goBack();
    } else {
      navigation.dispatch(StackActions.replace("Home"));
    }
  }, [navigation]);

  return hasCloudPublicConfig() ? <ConfiguredConnectOnboardingRouteScreen /> : null;
}

function ConfiguredConnectOnboardingRouteScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { isSignedIn, userId } = useAuth({ treatPendingAsSignedOut: false });
  const { connectedEnvironments, onReconnectEnvironment } = useRemoteConnections();
  const { refreshRelayEnvironments } = useConnectionController();
  const { connectedCloudEnvironments } = splitEnvironmentSections({
    connectedEnvironments,
    cloudEnvironments: null,
  });
  const mountedRef = useRef(true);
  const pullRefreshPendingRef = useRef(false);
  const optOutPendingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Pull-to-refresh tracks its own spinner instead of discovery's refreshing
  // flag, so background refreshes (e.g. the sign-in one) don't yank the
  // content down.
  const [isPullRefreshing, setIsPullRefreshing] = useState(false);
  const handlePullRefresh = useCallback(() => {
    if (pullRefreshPendingRef.current) return;
    pullRefreshPendingRef.current = true;
    setIsPullRefreshing(true);
    void (async () => {
      try {
        await refreshRelayEnvironments();
      } finally {
        pullRefreshPendingRef.current = false;
        if (mountedRef.current) setIsPullRefreshing(false);
      }
    })();
  }, [refreshRelayEnvironments]);

  const handleClose = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  // Persist before dismissing so a quick sign-out/sign-in cannot race ahead
  // of the preference write; the write is a local secure-store update.
  const handleDontShowAgain = useCallback(() => {
    if (optOutPendingRef.current) return;
    optOutPendingRef.current = true;
    void (async () => {
      try {
        if (userId) {
          const result = await settlePromise(() => optOutOfConnectOnboarding(userId));
          reportAtomCommandResult(result, { label: "connect onboarding opt-out" });
        }
        if (mountedRef.current && navigation.isFocused()) navigation.goBack();
      } finally {
        optOutPendingRef.current = false;
      }
    })();
  }, [navigation, userId]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <AndroidSheetHeader
          title={`Set up ${SURGE_CONNECT_NAME}`}
          actions={[{ accessibilityLabel: "Close", icon: "xmark", onPress: handleClose }]}
        />
      ) : (
        <NativeHeaderToolbar placement="right">
          <NativeHeaderToolbar.Button
            accessibilityLabel="Close Connect setup"
            icon="xmark"
            onPress={handleClose}
            separateBackground
          />
        </NativeHeaderToolbar>
      )}
      <ScrollView
        alwaysBounceVertical
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentInset={{ bottom: Math.max(insets.bottom, 18) + 18 }}
        contentContainerStyle={{
          gap: 16,
          paddingHorizontal: 20,
          paddingTop: 16,
        }}
        refreshControl={
          <RefreshControl refreshing={isPullRefreshing} onRefresh={handlePullRefresh} />
        }
      >
        {isSignedIn ? (
          <CloudEnvironmentRows
            connectedCloudEnvironments={connectedCloudEnvironments}
            onReconnectEnvironment={onReconnectEnvironment}
            showHeader={false}
          />
        ) : (
          <View collapsable={false} className="rounded-[24px] bg-card p-5">
            <Text className="text-sm leading-normal text-foreground-muted">
              Sign in to your {SURGE_CODE_ACCOUNT_NAME} account to set up {SURGE_CONNECT_NAME}.
            </Text>
          </View>
        )}

        {userId ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={handleDontShowAgain}
            className="items-center py-1 active:opacity-70"
          >
            <Text className="text-xs text-foreground-muted">{"Don't show this again"}</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}
