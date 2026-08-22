import { useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Haptics from "expo-haptics";
import { useCallback, useLayoutEffect, useState } from "react";
import { Alert, Platform, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidSheetHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { threadEnvironment } from "../../state/threads";
import { useAtomCommand } from "../../state/use-atom-command";
import { SheetActionButton } from "./git/gitSheetComponents";
import { normalizeThreadTitleInput } from "./thread-rename";

type ThreadRenameSheetProps = StaticScreenProps<{
  readonly environmentId: string;
  readonly threadId: string;
  readonly currentTitle: string;
}>;

export function ThreadRenameSheet(props: ThreadRenameSheetProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { currentTitle, environmentId, threadId } = props.route.params;
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const [title, setTitle] = useState(currentTitle);
  const [busy, setBusy] = useState(false);

  useLayoutEffect(() => {
    setTitle(currentTitle);
    setBusy(false);
  }, [currentTitle, environmentId, threadId]);

  const normalizedTitle = normalizeThreadTitleInput(title);
  const submit = useCallback(() => {
    if (normalizedTitle === null || busy) return;
    setBusy(true);
    void Haptics.selectionAsync();
    void updateThreadMetadata({
      environmentId: EnvironmentId.make(environmentId),
      input: { threadId: ThreadId.make(threadId), title: normalizedTitle },
    }).then((result) => {
      setBusy(false);
      if (result._tag === "Failure") {
        const error = Cause.squash(result.cause);
        Alert.alert(
          "Could not rename thread",
          error instanceof Error && error.message.trim().length > 0
            ? error.message
            : "The thread could not be renamed.",
        );
        return;
      }
      navigation.goBack();
    });
  }, [busy, environmentId, navigation, normalizedTitle, threadId, updateThreadMetadata]);

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <AndroidSheetHeader title="Rename thread" onBack={() => navigation.goBack()} />
      ) : null}
      <ScrollView
        className="flex-1"
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInset={{ bottom: Math.max(insets.bottom, 18) + 18 }}
        contentContainerClassName="gap-4 px-5 pt-2"
      >
        <View className="gap-2 rounded-[18px] border border-border bg-card px-4 py-4">
          <Text className="text-foreground-secondary text-2xs font-t3-bold tracking-[1px] uppercase">
            Thread title
          </Text>
          <TextInput
            autoFocus
            value={title}
            onChangeText={setTitle}
            placeholder="Thread title"
            className="rounded-[18px]"
            onSubmitEditing={submit}
            returnKeyType="done"
          />
          <SheetActionButton
            icon="checkmark"
            label="Save"
            tone="primary"
            disabled={busy || normalizedTitle === null}
            onPress={submit}
          />
        </View>
      </ScrollView>
    </View>
  );
}
