import {
  buildRemoteOpenUrl,
  EditorId,
  type EnvironmentId,
  type ResolvedKeybindingsConfig,
} from "@t3tools/contracts";
import { lazy, memo, Suspense, useCallback, useEffect, useMemo } from "react";
import { isOpenFavoriteEditorShortcut, shortcutLabelForCommand } from "../../keybindings";
import { usePreferredEditor } from "../../editorPreferences";
import { editorLabelForPlatform } from "../../editorLabels";
import {
  openRemoteEditorUrl,
  useRemoteCapableEditors,
  useRemoteOpenHint,
  useRemoteOpenState,
} from "../../remoteOpen";
import { useEnvironment } from "../../state/environments";
import { ChevronDownIcon, FolderClosedIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Menu, MenuItem, MenuPopup, MenuShortcut, MenuTrigger } from "../ui/menu";
import {
  AntigravityIcon,
  CursorIcon,
  Icon,
  KiroIcon,
  TraeIcon,
  VisualStudioCode,
  VisualStudioCodeInsiders,
  VSCodium,
  Zed,
} from "../Icons";
import { cn } from "~/lib/utils";
import { shellEnvironment } from "~/state/shell";
import { useAtomCommand } from "~/state/use-atom-command";
import { toastManager } from "../ui/toast";

// The JetBrains logos are gradient-heavy SVGs most users never see, so the
// module loads on first render of one of them. The fallback is an empty svg
// with the same props so menu/button sizing rules apply and nothing shifts.
const jetBrainsIcon = (name: keyof typeof import("../JetBrainsIcons")): Icon => {
  const LazyIcon = lazy(() =>
    import("../JetBrainsIcons").then((module) => ({ default: module[name] })),
  );
  return (props) => (
    <Suspense fallback={<svg {...props} />}>
      <LazyIcon {...props} />
    </Suspense>
  );
};
const AquaIcon = jetBrainsIcon("AquaIcon");
const CLionIcon = jetBrainsIcon("CLionIcon");
const DataGripIcon = jetBrainsIcon("DataGripIcon");
const DataSpellIcon = jetBrainsIcon("DataSpellIcon");
const GoLandIcon = jetBrainsIcon("GoLandIcon");
const IntelliJIdeaIcon = jetBrainsIcon("IntelliJIdeaIcon");
const PhpStormIcon = jetBrainsIcon("PhpStormIcon");
const PyCharmIcon = jetBrainsIcon("PyCharmIcon");
const RiderIcon = jetBrainsIcon("RiderIcon");
const RubyMineIcon = jetBrainsIcon("RubyMineIcon");
const RustRoverIcon = jetBrainsIcon("RustRoverIcon");
const WebStormIcon = jetBrainsIcon("WebStormIcon");

type OpenInOption = {
  label: string;
  Icon: Icon;
  value: EditorId;
  kind: "brand" | "generic";
};

const resolveOptions = (platform: string, availableEditors: ReadonlyArray<EditorId>) => {
  const baseOptions: ReadonlyArray<Omit<OpenInOption, "label">> = [
    {
      Icon: CursorIcon,
      value: "cursor",
      kind: "brand",
    },
    {
      Icon: TraeIcon,
      value: "trae",
      kind: "brand",
    },
    {
      Icon: KiroIcon,
      value: "kiro",
      kind: "brand",
    },
    {
      Icon: VisualStudioCode,
      value: "vscode",
      kind: "brand",
    },
    {
      Icon: VisualStudioCodeInsiders,
      value: "vscode-insiders",
      kind: "brand",
    },
    {
      Icon: VSCodium,
      value: "vscodium",
      kind: "brand",
    },
    {
      Icon: Zed,
      value: "zed",
      kind: "brand",
    },
    {
      Icon: AntigravityIcon,
      value: "antigravity",
      kind: "brand",
    },
    {
      Icon: IntelliJIdeaIcon,
      value: "idea",
      kind: "brand",
    },
    {
      Icon: AquaIcon,
      value: "aqua",
      kind: "brand",
    },
    {
      Icon: CLionIcon,
      value: "clion",
      kind: "brand",
    },
    {
      Icon: DataGripIcon,
      value: "datagrip",
      kind: "brand",
    },
    {
      Icon: DataSpellIcon,
      value: "dataspell",
      kind: "brand",
    },
    {
      Icon: GoLandIcon,
      value: "goland",
      kind: "brand",
    },
    {
      Icon: PhpStormIcon,
      value: "phpstorm",
      kind: "brand",
    },
    {
      Icon: PyCharmIcon,
      value: "pycharm",
      kind: "brand",
    },
    {
      Icon: RiderIcon,
      value: "rider",
      kind: "brand",
    },
    {
      Icon: RubyMineIcon,
      value: "rubymine",
      kind: "brand",
    },
    {
      Icon: RustRoverIcon,
      value: "rustrover",
      kind: "brand",
    },
    {
      Icon: WebStormIcon,
      value: "webstorm",
      kind: "brand",
    },
    {
      Icon: FolderClosedIcon,
      value: "file-manager",
      kind: "generic",
    },
  ];
  const availableEditorSet = new Set(availableEditors);
  return baseOptions
    .filter((option) => availableEditorSet.has(option.value))
    .map((option) => ({ ...option, label: editorLabelForPlatform(option.value, platform) }));
};

function getOpenInIconClass(kind: OpenInOption["kind"]) {
  return cn(kind === "brand" ? "text-foreground opacity-100" : "text-muted-foreground");
}

export const OpenInPicker = memo(function OpenInPicker({
  environmentId,
  keybindings,
  availableEditors,
  openInCwd,
  compact = false,
  enableShortcut = true,
}: {
  environmentId: EnvironmentId;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  openInCwd: string | null;
  compact?: boolean;
  enableShortcut?: boolean;
}) {
  const openInEditorMutation = useAtomCommand(shellEnvironment.openInEditor, "open in editor");
  const remote = useRemoteOpenState(environmentId);
  const remoteCapableEditors = useRemoteCapableEditors();
  const [remoteHintSeen, markRemoteHintSeen] = useRemoteOpenHint();
  const environmentLabel = useEnvironment(environmentId)?.label ?? "this machine";
  // Remote mode ignores the server's PATH probe: what matters is what runs on
  // the viewing machine, which only the desktop app can probe.
  const effectiveEditors = remote.mode === "local-exec" ? availableEditors : remoteCapableEditors;
  const [preferredEditor, setPreferredEditor] = usePreferredEditor(effectiveEditors);
  const options = useMemo(
    () => resolveOptions(navigator.platform, effectiveEditors),
    [effectiveEditors],
  );
  const primaryOption = options.find(({ value }) => value === preferredEditor) ?? null;

  const openInEditor = useCallback(
    (editorId: EditorId | null) => {
      if (!openInCwd) return;
      const editor = editorId ?? preferredEditor;
      if (!editor) return;
      if (remote.mode === "remote-unavailable") return;
      if (remote.mode === "remote-links") {
        const url = buildRemoteOpenUrl({
          editor,
          host: remote.host.host,
          absolutePath: openInCwd,
        });
        if (url === undefined) {
          toastManager.add({
            type: "error",
            title: "Could not open editor",
            description: "This editor does not support remote file links.",
          });
          return;
        }
        // Only record hint-seen/preferred when the shell actually accepted
        // the URL (an older desktop build can refuse the editor scheme).
        void openRemoteEditorUrl(url).then((opened) => {
          if (!opened) {
            toastManager.add({
              type: "error",
              title: "Could not open editor",
              description: "The operating system did not accept the editor link.",
            });
            return;
          }
          markRemoteHintSeen();
          setPreferredEditor(editor);
        });
        return;
      }
      const result = openInEditorMutation({
        environmentId,
        input: {
          cwd: openInCwd,
          editor,
        },
      });
      setPreferredEditor(editor);
      return result;
    },
    [
      environmentId,
      markRemoteHintSeen,
      openInCwd,
      openInEditorMutation,
      preferredEditor,
      remote,
      setPreferredEditor,
    ],
  );

  const openFavoriteEditorShortcutLabel = useMemo(
    () => shortcutLabelForCommand(keybindings, "editor.openFavorite"),
    [keybindings],
  );

  useEffect(() => {
    if (!enableShortcut) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (!isOpenFavoriteEditorShortcut(e, keybindings)) return;
      if (!openInCwd) return;
      if (!preferredEditor) return;

      e.preventDefault();
      void openInEditor(preferredEditor);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enableShortcut, keybindings, openInCwd, openInEditor, preferredEditor]);

  return (
    <Group aria-label="Open in editor">
      <Button
        aria-label={compact ? "Open file in preferred editor" : undefined}
        className="ps-[8.5px]"
        size="xs"
        variant="outline"
        disabled={!preferredEditor || !openInCwd || remote.mode === "remote-unavailable"}
        onClick={() => openInEditor(preferredEditor)}
      >
        {primaryOption?.Icon && (
          <primaryOption.Icon
            aria-hidden="true"
            className={cn("size-3.5", getOpenInIconClass(primaryOption.kind))}
          />
        )}
        <span
          className={
            compact
              ? "sr-only"
              : "sr-only @3xl/header-actions:not-sr-only @3xl/header-actions:ml-0.5"
          }
        >
          Open
        </span>
      </Button>
      <GroupSeparator {...(!compact ? { className: "hidden @3xl/header-actions:block" } : {})} />
      <Menu>
        <MenuTrigger
          render={<Button aria-label="Choose editor" size="icon-xs" variant="outline" />}
        >
          <ChevronDownIcon aria-hidden="true" className="size-4" />
        </MenuTrigger>
        <MenuPopup align="end">
          {remote.mode === "remote-unavailable" ? (
            <MenuItem disabled>No SSH route to {environmentLabel}</MenuItem>
          ) : (
            <>
              {options.length === 0 && <MenuItem disabled>No installed editors found</MenuItem>}
              {options.map(({ label, Icon, value, kind }) => (
                <MenuItem key={value} onClick={() => openInEditor(value)}>
                  <Icon aria-hidden="true" className={getOpenInIconClass(kind)} />
                  {label}
                  {value === preferredEditor && openFavoriteEditorShortcutLabel && (
                    <MenuShortcut>{openFavoriteEditorShortcutLabel}</MenuShortcut>
                  )}
                </MenuItem>
              ))}
              {remote.mode === "remote-links" && !remoteHintSeen && (
                <MenuItem disabled>Opens over SSH. Needs your key on {environmentLabel}</MenuItem>
              )}
            </>
          )}
        </MenuPopup>
      </Menu>
    </Group>
  );
});
