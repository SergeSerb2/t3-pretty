import { CameraView, useCameraPermissions } from "expo-camera";
import { NativeHeaderToolbar, NativeStackScreenOptions } from "../../native/StackHeader";
import {
  StackActions,
  useFocusEffect,
  useNavigation,
  type StaticScreenProps,
} from "@react-navigation/native";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, BackHandler, Linking, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  REMOTE_PAIRING_HOST_MAX_LENGTH,
  REMOTE_PAIRING_TOKEN_MAX_LENGTH,
  REMOTE_PAIRING_URL_MAX_LENGTH,
} from "@t3tools/shared/remote";
import { useUniwindTheme } from "../../lib/useUniwindTheme";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { ErrorBanner } from "../../components/ErrorBanner";
import { ConnectionSheetButton } from "./ConnectionSheetButton";
import { buildPairingUrl, extractPairingUrlFromQrPayload, parsePairingUrl } from "./pairing";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";

type ConnectionsNewRouteParams = {
  readonly mode?: string;
  readonly pairingUrl?: string;
  readonly autoConnect?: string;
};

export function ConnectionsNewRouteScreen({
  route,
}: StaticScreenProps<ConnectionsNewRouteParams | undefined>) {
  const {
    connectionPairingUrl,
    onChangeConnectionPairingUrl,
    onCancelConnectPress,
    onConnectPress,
    pairingConnectionError,
  } = useRemoteConnections();
  const navigation = useNavigation();
  const params = route.params ?? {};
  // Deep-link prefill exists for development automation only. A production
  // link must not arrive with attacker-chosen host and token already filled.
  const routePairingUrl =
    __DEV__ &&
    params.pairingUrl !== undefined &&
    params.pairingUrl.length <= REMOTE_PAIRING_URL_MAX_LENGTH
      ? params.pairingUrl.trim()
      : "";
  const shouldAutoConnect =
    __DEV__ &&
    routePairingUrl.length > 0 &&
    (params.autoConnect === "1" || params.autoConnect === "true");
  const insets = useSafeAreaInsets();
  const [hostInput, setHostInput] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showScanner, setShowScanner] = useState(params.mode === "scan_qr");
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const attemptedAutoConnectRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const cameraPermissionPendingRef = useRef(false);
  const scannerLockedRef = useRef(false);
  const scannerUnlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectAttemptGenerationRef = useRef(0);
  const activeConnectPairingUrlRef = useRef<string | null>(null);

  const headerIconColor = useUniwindTheme()["--color-icon"];

  const connectDisabled = isSubmitting || hostInput.trim().length === 0;

  const invalidateConnectAttempt = useCallback(
    (replacementPairingUrl?: string) => {
      const activePairingUrl = activeConnectPairingUrlRef.current;
      if (activePairingUrl === null || activePairingUrl === replacementPairingUrl) {
        return;
      }
      onCancelConnectPress();
      connectAttemptGenerationRef.current += 1;
      activeConnectPairingUrlRef.current = null;
      if (mountedRef.current) {
        setIsSubmitting(false);
      }
    },
    [onCancelConnectPress],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cameraPermissionPendingRef.current = false;
      scannerLockedRef.current = false;
      if (activeConnectPairingUrlRef.current !== null) {
        onCancelConnectPress();
      }
      connectAttemptGenerationRef.current += 1;
      activeConnectPairingUrlRef.current = null;
      if (scannerUnlockTimerRef.current !== null) {
        clearTimeout(scannerUnlockTimerRef.current);
        scannerUnlockTimerRef.current = null;
      }
    };
  }, [onCancelConnectPress]);

  useEffect(() => {
    // A non-empty value different from the URL this screen just submitted is
    // an external replacement and revokes the in-flight attempt.
    if (connectionPairingUrl.length > 0) {
      invalidateConnectAttempt(connectionPairingUrl);
    }
    const { host, code } = parsePairingUrl(connectionPairingUrl);
    setHostInput(host);
    setCodeInput(code);
  }, [connectionPairingUrl, invalidateConnectAttempt]);

  useEffect(() => {
    invalidateConnectAttempt(routePairingUrl);
    if (routePairingUrl.length === 0) {
      return;
    }

    const { host, code } = parsePairingUrl(routePairingUrl);
    setHostInput(host);
    setCodeInput(code);
  }, [invalidateConnectAttempt, routePairingUrl]);

  const handleHostChange = useCallback(
    (value: string) => {
      invalidateConnectAttempt();
      setHostInput(value.slice(0, REMOTE_PAIRING_HOST_MAX_LENGTH));
    },
    [invalidateConnectAttempt],
  );

  const handleCodeChange = useCallback(
    (value: string) => {
      invalidateConnectAttempt();
      setCodeInput(value.slice(0, REMOTE_PAIRING_TOKEN_MAX_LENGTH));
    },
    [invalidateConnectAttempt],
  );

  const openScanner = useCallback(async () => {
    if (cameraPermission?.granted) {
      scannerLockedRef.current = false;
      setShowScanner(true);
      return;
    }

    if (cameraPermissionPendingRef.current) return;
    cameraPermissionPendingRef.current = true;
    try {
      const permission = await requestCameraPermission();
      if (!mountedRef.current || !navigation.isFocused()) return;
      if (permission.granted) {
        scannerLockedRef.current = false;
        setShowScanner(true);
        return;
      }

      if (permission.canAskAgain) {
        Alert.alert(
          "Camera access needed",
          "Allow camera access to scan an environment pairing QR code.",
        );
        return;
      }

      Alert.alert(
        "Camera access needed",
        "Camera access was denied for this app. Open Settings to enable it.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Open Settings",
            onPress: () => {
              void Linking.openSettings().catch((error: unknown) => {
                Alert.alert(
                  "Couldn't open Settings",
                  error instanceof Error ? error.message : "Open Settings and allow camera access.",
                );
              });
            },
          },
        ],
      );
    } finally {
      cameraPermissionPendingRef.current = false;
    }
  }, [cameraPermission?.granted, navigation, requestCameraPermission]);

  const closeScanner = useCallback(() => {
    scannerLockedRef.current = false;
    setShowScanner(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android" || !showScanner) {
        return;
      }
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        closeScanner();
        return true;
      });
      return () => subscription.remove();
    }, [closeScanner, showScanner]),
  );

  const handleQrScan = useCallback(
    ({ data }: { readonly data: string }) => {
      if (scannerLockedRef.current) {
        return;
      }

      scannerLockedRef.current = true;

      try {
        const pairingUrl = extractPairingUrlFromQrPayload(data);
        const { host, code } = parsePairingUrl(pairingUrl);
        invalidateConnectAttempt(pairingUrl);
        setHostInput(host);
        setCodeInput(code);
        onChangeConnectionPairingUrl(pairingUrl);
        setShowScanner(false);
      } catch (error) {
        Alert.alert(
          "Invalid QR code",
          error instanceof Error ? error.message : "Scanned QR code was not recognized.",
        );
      } finally {
        if (scannerUnlockTimerRef.current !== null) {
          clearTimeout(scannerUnlockTimerRef.current);
        }
        scannerUnlockTimerRef.current = setTimeout(() => {
          scannerUnlockTimerRef.current = null;
          scannerLockedRef.current = false;
        }, 600);
      }
    },
    [invalidateConnectAttempt, onChangeConnectionPairingUrl],
  );

  const connectAndClose = useCallback(
    async (pairingUrl: string, replaceWithHome: boolean) => {
      if (activeConnectPairingUrlRef.current !== null) return;
      const generation = connectAttemptGenerationRef.current + 1;
      connectAttemptGenerationRef.current = generation;
      activeConnectPairingUrlRef.current = pairingUrl;
      setIsSubmitting(true);
      onChangeConnectionPairingUrl(pairingUrl);
      try {
        const result = await onConnectPress(pairingUrl);
        if (
          AsyncResult.isSuccess(result) &&
          mountedRef.current &&
          connectAttemptGenerationRef.current === generation &&
          activeConnectPairingUrlRef.current === pairingUrl &&
          navigation.isFocused()
        ) {
          if (replaceWithHome || !navigation.canGoBack()) {
            navigation.dispatch(StackActions.replace("Home"));
          } else {
            navigation.goBack();
          }
        }
      } finally {
        if (
          connectAttemptGenerationRef.current === generation &&
          activeConnectPairingUrlRef.current === pairingUrl
        ) {
          activeConnectPairingUrlRef.current = null;
          if (mountedRef.current) {
            setIsSubmitting(false);
          }
        }
      }
    },
    [navigation, onChangeConnectionPairingUrl, onConnectPress],
  );

  const handleSubmit = useCallback(async () => {
    await connectAndClose(buildPairingUrl(hostInput, codeInput), false);
  }, [codeInput, connectAndClose, hostInput]);

  useEffect(() => {
    if (!shouldAutoConnect || attemptedAutoConnectRef.current === routePairingUrl) {
      return;
    }

    attemptedAutoConnectRef.current = routePairingUrl;
    void connectAndClose(routePairingUrl, true);
  }, [connectAndClose, routePairingUrl, shouldAutoConnect]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <NativeStackScreenOptions
        options={{
          // Android renders its own in-screen header below instead of the native bar.
          ...(Platform.OS === "android" ? { headerShown: false } : null),
          title: showScanner ? "Scan QR Code" : "Add Environment",
        }}
      />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          title={showScanner ? "Scan QR Code" : "Add Environment"}
          onBack={showScanner ? closeScanner : () => navigation.goBack()}
          actions={[
            {
              accessibilityLabel: showScanner ? "Close scanner" : "Scan QR code",
              icon: showScanner ? "xmark" : "camera",
              onPress: () => {
                if (showScanner) {
                  closeScanner();
                } else {
                  void openScanner();
                }
              },
            },
          ]}
        />
      ) : (
        <NativeHeaderToolbar placement="right">
          <NativeHeaderToolbar.Button
            accessibilityLabel={showScanner ? "Close scanner" : "Scan QR code"}
            icon={showScanner ? "xmark" : "qrcode.viewfinder"}
            onPress={() => {
              if (showScanner) {
                closeScanner();
              } else {
                void openScanner();
              }
            }}
            separateBackground
            tintColor={headerIconColor}
          />
        </NativeHeaderToolbar>
      )}

      <ScrollView
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentInset={
          Platform.OS === "ios" ? { bottom: Math.max(insets.bottom, 18) + 18 } : undefined
        }
        contentContainerStyle={{
          paddingBottom: Platform.OS === "android" ? Math.max(insets.bottom, 18) + 18 : undefined,
          paddingHorizontal: 20,
          paddingTop: 16,
        }}
      >
        <View collapsable={false} className="gap-5">
          {showScanner ? (
            cameraPermission?.granted ? (
              <View className="overflow-hidden rounded-[24px] border-continuous">
                <CameraView
                  barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                  onBarcodeScanned={handleQrScan}
                  style={{ aspectRatio: 1, width: "100%" }}
                />
              </View>
            ) : (
              <View className="items-center gap-3 rounded-[24px] border-continuous bg-card px-5 py-8">
                <Text className="text-center text-sm leading-normal text-foreground-muted">
                  Camera permission is required to scan a QR code.
                </Text>
                <ConnectionSheetButton
                  compact
                  icon="camera"
                  label="Allow camera"
                  tone="secondary"
                  onPress={() => {
                    void openScanner();
                  }}
                />
              </View>
            )
          ) : (
            <View collapsable={false} className="gap-4 rounded-[24px] bg-card p-4">
              <View collapsable={false} className="gap-1.5">
                <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                  Host
                </Text>
                <TextInput
                  accessibilityLabel="Host"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  maxLength={REMOTE_PAIRING_HOST_MAX_LENGTH}
                  placeholder="192.168.1.100:8080"
                  value={hostInput}
                  onChangeText={handleHostChange}
                  className="rounded-[14px] border border-input-border bg-input px-4 py-3.5 text-base text-foreground"
                />
              </View>

              <View collapsable={false} className="gap-1.5">
                <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                  Pairing code
                </Text>
                <TextInput
                  accessibilityLabel="Pairing code"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={REMOTE_PAIRING_TOKEN_MAX_LENGTH}
                  placeholder="abc-123-xyz"
                  value={codeInput}
                  onChangeText={handleCodeChange}
                  className="rounded-[14px] border border-input-border bg-input px-4 py-3.5 text-base text-foreground"
                />
              </View>

              {pairingConnectionError ? <ErrorBanner message={pairingConnectionError} /> : null}

              <ConnectionSheetButton
                icon="plus"
                label={isSubmitting ? "Pairing..." : "Add environment"}
                disabled={connectDisabled}
                tone="primary"
                onPress={() => {
                  void handleSubmit();
                }}
              />
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
