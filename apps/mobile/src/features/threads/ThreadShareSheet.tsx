import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef, ThreadShareInfo } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import * as Option from "effect/Option";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  TextInput,
  View,
} from "react-native";
import { AppText } from "../../components/AppText";
import { usePreparedConnection } from "../../state/session";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";

export function ThreadShareSheet({
  target,
  onClose,
}: {
  readonly target: ScopedThreadRef;
  readonly onClose: () => void;
}) {
  const connection = usePreparedConnection(target.environmentId);
  const [baseUrl, setBaseUrl] = useState(
    Option.isSome(connection) ? connection.value.httpBaseUrl : "",
  );
  const [share, setShare] = useState<ThreadShareInfo | null>(null);
  const [pending, setPending] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canPublish = useAtomValue(
    threadEnvironment.publishShare.permissionAtom(target.environmentId),
  );
  const canRevoke = useAtomValue(
    threadEnvironment.revokeShare.permissionAtom(target.environmentId),
  );
  const get = useAtomCommand(threadEnvironment.getShare, { reportFailure: false });
  const publish = useAtomCommand(threadEnvironment.publishShare, { reportFailure: false });
  const revoke = useAtomCommand(threadEnvironment.revokeShare, { reportFailure: false });
  useEffect(() => {
    let active = true;
    void get({ environmentId: target.environmentId, input: { threadId: target.threadId } }).then(
      (result) => {
        if (!active) return;
        setPending(false);
        if (result._tag === "Failure") {
          setError(String(squashAtomCommandFailure(result)));
          return;
        }
        setLoaded(true);
        setShare(result.value);
        if (result.value) setBaseUrl(new URL(result.value.url).origin);
      },
    );
    return () => {
      active = false;
    };
  }, [get, target.environmentId, target.threadId]);
  const change = async (action: "publish" | "revoke") => {
    setPending(true);
    setError(null);
    if (action === "publish") {
      const result = await publish({
        environmentId: target.environmentId,
        input: { threadId: target.threadId, publicBaseUrl: baseUrl },
      });
      if (result._tag === "Success") setShare(result.value);
      else setError(String(squashAtomCommandFailure(result)));
    } else {
      const result = await revoke({
        environmentId: target.environmentId,
        input: { threadId: target.threadId },
      });
      if (result._tag === "Success") setShare(null);
      else setError(String(squashAtomCommandFailure(result)));
    }
    setPending(false);
  };
  return (
    <Modal visible transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        className="flex-1 items-center justify-center bg-backdrop px-6"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          className="max-h-[80%] w-full max-w-md grow-0 rounded-3xl bg-screen"
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: 24, gap: 20 }}
        >
          <AppText accessibilityRole="header" className="text-xl font-t3-semibold">
            Share thread publicly
          </AppText>
          <AppText>
            Anyone with the link can read a snapshot without signing in. Includes user and assistant
            text. Excludes tool output, reasoning, attachments, and hidden instructions. Review
            private information before sharing.
          </AppText>
          <View className="gap-2">
            <AppText>Public server URL</AppText>
            <TextInput
              accessibilityLabel="Public server URL"
              className="min-h-12 rounded-xl bg-subtle px-3 text-foreground"
              value={baseUrl}
              onChangeText={setBaseUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://your-server.example.com"
              editable={!pending}
            />
            <AppText className="text-sm text-foreground-secondary">
              Use this environment’s public address or tunnel. The server must stay online. Private
              addresses only work for people who can reach them.
            </AppText>
          </View>
          {share && (
            <View className="gap-3">
              <AppText selectable>{share.url}</AppText>
              <AppText className="text-sm text-foreground-secondary">
                {share.messageCount} messages · {new Date(share.publishedAt).toLocaleString()}.
                Later messages stay private until you update the snapshot.
              </AppText>
              <Pressable
                accessibilityRole="button"
                className="min-h-12 items-center justify-center rounded-xl bg-subtle"
                onPress={() => {
                  void Share.share({ message: share.url }).catch(() =>
                    setError("Could not share the link. Select and copy it above."),
                  );
                }}
              >
                <AppText>Share link</AppText>
              </Pressable>
            </View>
          )}
          {error && <AppText accessibilityRole="alert">{error}</AppText>}
          {pending && <AppText>Saving or loading shared conversation…</AppText>}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: pending || !loaded || !canPublish || !baseUrl.trim() }}
            disabled={pending || !loaded || !canPublish || !baseUrl.trim()}
            className="min-h-12 items-center justify-center rounded-xl bg-subtle"
            onPress={() => void change("publish")}
          >
            <AppText>{share ? "Update snapshot" : "Create public link"}</AppText>
          </Pressable>
          {share && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pending || !canRevoke }}
              disabled={pending || !canRevoke}
              className="min-h-12 items-center justify-center rounded-xl bg-subtle"
              onPress={() => void change("revoke")}
            >
              <AppText>Stop sharing</AppText>
            </Pressable>
          )}
          <Pressable
            accessibilityRole="button"
            className="min-h-12 items-center justify-center"
            onPress={onClose}
          >
            <AppText>Close</AppText>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
