import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo, useRef, useState, type ChangeEvent } from "react";

import { primaryServerKeybindingsAtom } from "~/state/server";
import { isMacPlatform, isWindowsPlatform } from "~/lib/utils";
import { useTheme } from "~/hooks/useTheme";
import { CommandPaletteContent } from "../CommandPaletteContent";
import type { CommandPaletteActionItem } from "../CommandPalette.logic";
import { CommandPaletteResults } from "../CommandPaletteResults";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import {
  getProjectFilePickerMatches,
  PROJECT_FILE_PICKER_RESULT_LIMIT,
} from "../files/ProjectFilePicker.logic";
import { useProjectFilePickerQuery } from "../files/projectFilesQueryState";
import { Button } from "../ui/button";
import { CommandDialog, CommandDialogPopup } from "../ui/command";

const PROJECT_ICON_FILE_ACCEPT =
  ".avif,.gif,.ico,.jpeg,.jpg,.png,.svg,.webp,image/avif,image/gif,image/jpeg,image/png,image/svg+xml,image/webp,image/x-icon";

function emptyMessage(query: string, error: string | null, isPending: boolean): string {
  if (error) return error;
  if (isPending) return query.trim() ? "Searching project files…" : "Indexing project files…";
  return query.trim() ? "No matching image files." : "No image files found.";
}

function browseComputerLabel(platform: string): string {
  if (isMacPlatform(platform)) return "Browse in Finder";
  if (isWindowsPlatform(platform)) return "Browse in Explorer";
  return "Browse computer";
}

export function ProjectFaviconPickerDialog(props: {
  readonly cwd: string;
  readonly disabled?: boolean;
  readonly environmentId: EnvironmentId;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSelect: (path: string) => void;
  readonly onSelectComputerFile: (file: File) => void;
  readonly open: boolean;
  readonly projectName: string;
}) {
  const [query, setQuery] = useState("");
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const result = useProjectFilePickerQuery(
    props.environmentId,
    props.cwd,
    query,
    PROJECT_FILE_PICKER_RESULT_LIMIT,
    { imageOnly: true },
  );
  const { resolvedTheme } = useTheme();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const items = useMemo<CommandPaletteActionItem[]>(
    () =>
      getProjectFilePickerMatches(result.entries, result.matchedQuery).map((match) => ({
        kind: "action",
        value: `project-favicon:${match.path}`,
        searchTerms: [match.name, match.path],
        title: match.name,
        description: match.path,
        icon: <PierreEntryIcon pathValue={match.path} kind="file" theme={resolvedTheme} />,
        run: async () => props.onSelect(match.path),
      })),
    [props.onSelect, resolvedTheme, result.entries, result.matchedQuery],
  );

  const handleComputerFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    props.onOpenChange(false);
    props.onSelectComputerFile(file);
  };

  return (
    <CommandDialog open={props.open} onOpenChange={props.onOpenChange}>
      {props.open ? (
        <CommandDialogPopup
          aria-label="Choose project icon"
          className="overflow-hidden p-0"
          onBackdropPointerDown={() => props.onOpenChange(false)}
        >
          <CommandPaletteContent
            aria-label="Choose project icon"
            autoHighlight="always"
            escapeLabel="Close"
            footerActionLabel="Select icon"
            footerTrailing={
              <Button
                variant="ghost"
                size="xs"
                className="h-auto px-2 text-muted-foreground text-xs hover:bg-transparent hover:text-foreground"
                disabled={props.disabled}
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                {browseComputerLabel(navigator.platform)}
              </Button>
            }
            inputProps={{ placeholder: "Search image files…" }}
            mode="none"
            onItemHighlighted={(value) => {
              setHighlightedItemValue(typeof value === "string" ? value : null);
            }}
            onValueChange={(value) => {
              setHighlightedItemValue(null);
              setQuery(value);
            }}
            panelClassName="max-h-[min(34rem,76vh)]"
            testId="project-favicon-picker"
            value={query}
          >
            <CommandPaletteResults
              groups={
                items.length > 0
                  ? [{ value: "project-favicon-files", label: props.projectName, items }]
                  : []
              }
              highlightedItemValue={highlightedItemValue}
              isActionsOnly={false}
              keybindings={keybindings}
              onExecuteItem={(item) => {
                if (item.kind !== "action") return;
                props.onOpenChange(false);
                void item.run();
              }}
              emptyStateMessage={emptyMessage(query, result.error, result.isPending)}
            />
          </CommandPaletteContent>
          <input
            ref={fileInputRef}
            accept={PROJECT_ICON_FILE_ACCEPT}
            hidden
            type="file"
            onChange={handleComputerFileChange}
          />
        </CommandDialogPopup>
      ) : null}
    </CommandDialog>
  );
}
