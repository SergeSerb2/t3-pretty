/**
 * Settings › Instructions — view and edit the markdown guidance files coding
 * agents load: global per-provider files (`~/.codex/AGENTS.md`,
 * `~/.claude/CLAUDE.md`, …) and per-project files (`AGENTS.md`, `CLAUDE.md`,
 * `CLAUDE.local.md`). File discovery and path resolution live server-side —
 * this panel only ever addresses files by server-minted ids.
 */
import type { EditorView } from "@codemirror/view";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { AgentInstructionFile, EnvironmentId } from "@t3tools/contracts";
import {
  ArrowLeftIcon,
  BoldIcon,
  CheckIcon,
  ChevronRightIcon,
  CodeIcon,
  EyeIcon,
  FileTextIcon,
  FolderIcon,
  GlobeIcon,
  Heading1Icon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  LoaderCircleIcon,
  PenLineIcon,
  QuoteIcon,
  SparklesIcon,
  StrikethroughIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";
import { agentInstructionsEnvironment } from "~/state/agentInstructions";
import { usePrimaryEnvironmentId } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatRelativeTimeLabel } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { MarkdownEditor } from "../markdown-editor/MarkdownEditor";
import { markdownEditorActions } from "../markdown-editor/markdownEditorCommands";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ClaudeAI } from "../Icons";
import { getDriverOption } from "./providerDriverMeta";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";
import { searchableSetting } from "./settingsSearch";
import { useSettingsProjectGroups } from "./ProjectSettingsPanel";
import "./agentInstructions.css";

const STARTER_TEMPLATE = `# Instructions

## Style

- Keep answers short and direct.

## Workflow

- Run the tests before declaring work done.
`;

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface OpenTarget {
  readonly file: AgentInstructionFile;
  readonly environmentId: EnvironmentId;
  readonly projectCwd?: string;
  readonly contextLabel: string;
}

export function AgentInstructionsSettingsPanel() {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const projectGroups = useSettingsProjectGroups();
  const [selectedProjectKey, setSelectedProjectKey] = useState<string | null>(null);
  const selectedProject = useMemo(
    () =>
      projectGroups.find((group) => group.projectKey === selectedProjectKey) ??
      projectGroups[0] ??
      null,
    [projectGroups, selectedProjectKey],
  );

  const globalListAtom =
    primaryEnvironmentId === null
      ? null
      : agentInstructionsEnvironment.list({ environmentId: primaryEnvironmentId, input: {} });
  const globalList = useEnvironmentQuery(globalListAtom);

  const projectListAtom =
    selectedProject === null
      ? null
      : agentInstructionsEnvironment.list({
          environmentId: selectedProject.environmentId,
          input: { projectCwd: selectedProject.workspaceRoot },
        });
  const projectList = useEnvironmentQuery(projectListAtom);

  const globalFiles = useMemo(
    () => (globalList.data?.files ?? []).filter((file) => file.scope === "global"),
    [globalList.data],
  );
  const projectFiles = useMemo(
    () => (projectList.data?.files ?? []).filter((file) => file.scope === "project"),
    [projectList.data],
  );

  const [openTarget, setOpenTarget] = useState<OpenTarget | null>(null);
  const refreshLists = useCallback(() => {
    globalList.refresh();
    projectList.refresh();
  }, [globalList, projectList]);

  if (openTarget !== null) {
    return (
      <SettingsPageContainer className="max-w-5xl">
        <InstructionFileEditor
          key={`${openTarget.environmentId}:${openTarget.file.id}:${openTarget.projectCwd ?? ""}`}
          target={openTarget}
          onClose={() => setOpenTarget(null)}
          onSaved={refreshLists}
        />
      </SettingsPageContainer>
    );
  }

  return (
    <SettingsPageContainer>
      <SettingsSection
        {...searchableSetting("agent-instructions-global")}
        title="Global instructions"
        icon={<GlobeIcon className="size-4.5 text-muted-foreground" />}
      >
        <p className="px-3 pb-2 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
          Standing guidance each provider loads for every thread, in every project. Stored in the
          provider&rsquo;s own home directory, so the same rules apply outside T3 Code too.
        </p>
        {primaryEnvironmentId === null ? (
          <InstructionListHint>
            Connect an environment to manage global instructions.
          </InstructionListHint>
        ) : globalList.error !== null ? (
          <InstructionListHint tone="error">{globalList.error}</InstructionListHint>
        ) : globalList.data === null ? (
          <InstructionListSkeleton rows={5} />
        ) : (
          globalFiles.map((file) => (
            <InstructionFileRow
              key={file.id}
              file={file}
              onOpen={() =>
                setOpenTarget({
                  file,
                  environmentId: primaryEnvironmentId,
                  contextLabel: "Global",
                })
              }
            />
          ))
        )}
      </SettingsSection>

      <SettingsSection
        {...searchableSetting("agent-instructions-project")}
        title="Project instructions"
        icon={<FolderIcon className="size-4.5 text-muted-foreground" />}
        headerAction={
          projectGroups.length > 1 && selectedProject !== null ? (
            <Select
              value={selectedProject.projectKey}
              onValueChange={(value) => setSelectedProjectKey(value as string)}
            >
              <SelectTrigger className="w-56" aria-label="Project">
                <SelectValue>{selectedProject.displayName}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {projectGroups.map((group) => (
                  <SelectItem key={group.projectKey} hideIndicator value={group.projectKey}>
                    {group.displayName}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          ) : null
        }
      >
        <p className="px-3 pb-2 text-[13px] leading-[1.45] text-muted-foreground/80 sm:px-4">
          Rules that live at the project root and steer agents only in that workspace. Committed
          files travel with the repository; local files stay on this machine.
        </p>
        {selectedProject === null ? (
          <InstructionListHint>
            Add a project to manage per-project instructions.
          </InstructionListHint>
        ) : projectList.error !== null ? (
          <InstructionListHint tone="error">{projectList.error}</InstructionListHint>
        ) : projectList.data === null ? (
          <InstructionListSkeleton rows={3} />
        ) : (
          projectFiles.map((file) => (
            <InstructionFileRow
              key={file.id}
              file={file}
              onOpen={() =>
                setOpenTarget({
                  file,
                  environmentId: selectedProject.environmentId,
                  projectCwd: selectedProject.workspaceRoot,
                  contextLabel: selectedProject.displayName,
                })
              }
            />
          ))
        )}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function InstructionListHint({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "error";
}) {
  return (
    <p
      className={cn(
        "px-3 py-2 text-[13px] sm:px-4",
        tone === "error" ? "text-destructive-foreground" : "text-muted-foreground",
      )}
    >
      {children}
    </p>
  );
}

const SKELETON_ROW_KEYS = ["one", "two", "three", "four", "five"] as const;

function InstructionListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-1 px-3 sm:px-4">
      {SKELETON_ROW_KEYS.slice(0, rows).map((key) => (
        <Skeleton key={key} className="h-14 w-full rounded-xl" />
      ))}
    </div>
  );
}

function InstructionFileIcon({ file }: { file: AgentInstructionFile }) {
  const driverOption = getDriverOption(file.driver);
  if (driverOption !== undefined) {
    const DriverIcon = driverOption.icon;
    return <DriverIcon className="size-4.5" />;
  }
  if (file.fileName.startsWith("CLAUDE")) {
    return <ClaudeAI className="size-4.5" />;
  }
  return <FileTextIcon className="size-4.5" />;
}

function InstructionFileRow({ file, onOpen }: { file: AgentInstructionFile; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="t3-instruction-row group flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors duration-100 hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:px-4"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-background/60 text-foreground transition-transform duration-150 group-hover:scale-105 group-active:scale-95">
        <InstructionFileIcon file={file} />
      </span>
      <span className="min-w-0 flex-1 space-y-0.5">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm font-medium tracking-[-0.005em] text-foreground">
            {file.title}
          </span>
          <code className="rounded bg-accent/60 px-1.5 py-px font-mono text-[11px] text-muted-foreground">
            {file.fileName}
          </code>
          {file.exists ? null : (
            <Badge variant="outline" size="sm" className="text-muted-foreground">
              Not created
            </Badge>
          )}
        </span>
        <span className="block truncate text-[13px] leading-[1.45] text-muted-foreground/80">
          {file.description ?? file.displayPath}
        </span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground/60">
          {file.displayPath}
          {file.exists && file.sizeBytes !== undefined
            ? ` · ${formatByteSize(file.sizeBytes)}`
            : ""}
          {file.exists && file.modifiedAtMs !== undefined
            ? ` · edited ${formatRelativeTimeLabel(new Date(file.modifiedAtMs).toISOString())}`
            : ""}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground transition-transform duration-150 group-hover:translate-x-0.5">
        {file.exists ? null : <span className="text-xs font-medium text-primary">Create</span>}
        <ChevronRightIcon className="size-4" />
      </span>
    </button>
  );
}

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 900;

function InstructionFileEditor({
  target,
  onClose,
  onSaved,
}: {
  target: OpenTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { file, environmentId, projectCwd } = target;
  const readAtom = agentInstructionsEnvironment.read({
    environmentId,
    input: { fileId: file.id, ...(projectCwd === undefined ? {} : { projectCwd }) },
  });
  const readQuery = useEnvironmentQuery(readAtom);
  const writeFile = useAtomCommand(agentInstructionsEnvironment.write, { reportFailure: false });

  const [mode, setMode] = useState<"write" | "preview">("write");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [contents, setContents] = useState<string | null>(null);
  const contentsRef = useRef<string | null>(null);
  const savedContentsRef = useRef<string | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loaded = readQuery.data !== null;
  const loadedContents = readQuery.data?.contents ?? "";
  const truncated = readQuery.data?.truncated === true;
  const readOnly = truncated;

  useEffect(() => {
    if (!loaded) return;
    if (savedContentsRef.current === null) {
      savedContentsRef.current = loadedContents;
      contentsRef.current = loadedContents;
      setContents(loadedContents);
    }
  }, [loaded, loadedContents]);

  const performSave = useCallback(async () => {
    const current = contentsRef.current;
    if (current === null || current === savedContentsRef.current) return;
    setSaveState("saving");
    setSaveError(null);
    const result = await writeFile({
      environmentId,
      input: {
        fileId: file.id,
        ...(projectCwd === undefined ? {} : { projectCwd }),
        contents: current,
      },
    });
    if (result._tag === "Success") {
      savedContentsRef.current = current;
      // Contents may have changed again while the write was in flight.
      setSaveState(contentsRef.current === current ? "saved" : "dirty");
      onSaved();
      readQuery.refresh();
    } else if (!isAtomCommandInterrupted(result)) {
      setSaveState("error");
      const failure = squashAtomCommandFailure(result);
      setSaveError(failure instanceof Error ? failure.message : "Could not save the file.");
    }
  }, [environmentId, file.id, onSaved, projectCwd, readQuery, writeFile]);
  // `readQuery` is a fresh object every render, so the callback identity churns;
  // route timer/unmount callers through a ref to keep them stable.
  const performSaveRef = useRef(performSave);
  performSaveRef.current = performSave;

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current !== null) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void performSaveRef.current();
    }, SAVE_DEBOUNCE_MS);
  }, []);

  const flushSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    void performSaveRef.current();
  }, []);

  const handleChange = useCallback(
    (next: string) => {
      contentsRef.current = next;
      setContents(next);
      if (next !== savedContentsRef.current) {
        setSaveState("dirty");
        scheduleSave();
      } else {
        setSaveState("idle");
      }
    },
    [scheduleSave],
  );

  // Flush pending edits when the editor unmounts (close, project switch, …).
  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      void performSaveRef.current();
    };
  }, []);

  const handleClose = useCallback(() => {
    flushSave();
    onClose();
  }, [flushSave, onClose]);

  const wordCount = useMemo(() => {
    if (contents === null) return 0;
    const words = contents.trim().match(/\S+/g);
    return words === null ? 0 : words.length;
  }, [contents]);

  const insertTemplate = useCallback(() => {
    const view = viewRef.current;
    if (view === null) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: STARTER_TEMPLATE },
      userEvent: "input",
    });
    view.focus();
  }, []);

  const showTemplateAction = loaded && !readOnly && (contents ?? "").trim().length === 0;

  return (
    <div className="t3-instruction-editor flex min-h-0 flex-col gap-4">
      <div className="flex items-start justify-between gap-4 px-1">
        <div className="flex min-w-0 items-start gap-3">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Back to instruction files"
            onClick={handleClose}
            className="mt-0.5 shrink-0"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <div className="min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center text-foreground">
                <InstructionFileIcon file={file} />
              </span>
              <h2 className="truncate text-lg font-semibold tracking-[-0.025em] text-foreground">
                {file.title}
              </h2>
              <Badge variant="secondary" size="sm">
                {target.contextLabel}
              </Badge>
            </div>
            <p className="truncate font-mono text-xs text-muted-foreground/70">
              {file.displayPath}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <SaveStateIndicator state={saveState} />
          <ModeToggle mode={mode} onModeChange={setMode} />
        </div>
      </div>

      {truncated ? (
        <EditorNotice icon={TriangleAlertIcon}>
          This file is larger than 1&nbsp;MB, so it opened read-only to avoid a lossy save.
        </EditorNotice>
      ) : null}
      {saveError !== null ? (
        <EditorNotice icon={TriangleAlertIcon} tone="error">
          {saveError}
          <Button variant="outline" size="xs" className="ms-2" onClick={() => void performSave()}>
            Retry
          </Button>
        </EditorNotice>
      ) : null}

      <div className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card/40 shadow-xs transition-[border-color,box-shadow] duration-150 focus-within:border-ring/50 focus-within:shadow-sm">
        {mode === "write" && !readOnly ? (
          <EditorToolbar
            viewRef={viewRef}
            trailing={
              showTemplateAction ? (
                <Button variant="ghost" size="xs" onClick={insertTemplate} className="gap-1.5">
                  <SparklesIcon className="size-3.5" />
                  Insert starter template
                </Button>
              ) : null
            }
          />
        ) : null}
        <div className="h-[58vh] min-h-[320px]">
          {!loaded && readQuery.error === null ? (
            <div className="space-y-3 p-5">
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-5/6" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          ) : readQuery.error !== null ? (
            <InstructionListHint tone="error">{readQuery.error}</InstructionListHint>
          ) : mode === "preview" ? (
            <ScrollArea className="h-full">
              {(contents ?? "").trim().length === 0 ? (
                <p className="px-5 py-4 text-sm text-muted-foreground italic">
                  Nothing to preview yet.
                </p>
              ) : (
                <ChatMarkdown text={contents ?? ""} cwd={projectCwd} className="px-5 py-4" />
              )}
            </ScrollArea>
          ) : (
            <MarkdownEditor
              contentKey={`${environmentId}:${file.id}:${projectCwd ?? ""}`}
              initialContents={savedContentsRef.current ?? loadedContents}
              placeholder={
                file.scope === "global"
                  ? `Standing guidance for ${file.title} in every project…`
                  : "Guidance for agents working in this project…"
              }
              readOnly={readOnly}
              autoFocus
              ariaLabel={`${file.title} instructions`}
              className="h-full"
              onChange={handleChange}
              onSave={flushSave}
              onBlur={flushSave}
              onViewReady={(view) => {
                viewRef.current = view;
              }}
            />
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border/40 px-4 py-1.5 text-[11px] text-muted-foreground/70">
          <span>
            {wordCount} {wordCount === 1 ? "word" : "words"}
          </span>
          <span className="font-mono">Markdown · ⌘S to save</span>
        </div>
      </div>
    </div>
  );
}

function EditorNotice({
  icon: Icon,
  tone = "warning",
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  tone?: "warning" | "error";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-[13px]",
        tone === "error"
          ? "bg-destructive/8 text-destructive-foreground"
          : "bg-warning/8 text-warning-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

function SaveStateIndicator({ state }: { state: SaveState }) {
  if (state === "idle") return null;
  return (
    <span
      className={cn(
        "t3-save-indicator flex items-center gap-1 text-xs",
        state === "error" ? "text-destructive-foreground" : "text-muted-foreground",
      )}
      data-state={state}
    >
      {state === "saving" ? <LoaderCircleIcon className="size-3 animate-spin" /> : null}
      {state === "saved" ? <CheckIcon className="size-3 text-success-foreground" /> : null}
      {state === "dirty" ? <span className="size-1.5 rounded-full bg-primary" /> : null}
      {state === "saving"
        ? "Saving…"
        : state === "saved"
          ? "Saved"
          : state === "error"
            ? "Save failed"
            : "Unsaved"}
    </span>
  );
}

function ModeToggle({
  mode,
  onModeChange,
}: {
  mode: "write" | "preview";
  onModeChange: (mode: "write" | "preview") => void;
}) {
  return (
    <div className="flex items-center rounded-lg border border-border/60 bg-background/60 p-0.5">
      {(
        [
          { value: "write", label: "Write", icon: PenLineIcon },
          { value: "preview", label: "Preview", icon: EyeIcon },
        ] as const
      ).map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onModeChange(option.value)}
          aria-pressed={mode === option.value}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all duration-150",
            mode === option.value
              ? "bg-accent text-foreground shadow-xs"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <option.icon className="size-3.5" />
          {option.label}
        </button>
      ))}
    </div>
  );
}

const TOOLBAR_ACTIONS: ReadonlyArray<
  | { readonly type: "divider"; readonly id: string }
  | {
      readonly type: "action";
      readonly label: string;
      readonly icon: ComponentType<{ className?: string }>;
      readonly run: (view: EditorView) => boolean;
    }
> = [
  { type: "action", label: "Heading 1", icon: Heading1Icon, run: markdownEditorActions.heading(1) },
  { type: "action", label: "Heading 2", icon: Heading2Icon, run: markdownEditorActions.heading(2) },
  { type: "action", label: "Heading 3", icon: Heading3Icon, run: markdownEditorActions.heading(3) },
  { type: "divider", id: "after-headings" },
  { type: "action", label: "Bold", icon: BoldIcon, run: markdownEditorActions.bold },
  { type: "action", label: "Italic", icon: ItalicIcon, run: markdownEditorActions.italic },
  {
    type: "action",
    label: "Strikethrough",
    icon: StrikethroughIcon,
    run: markdownEditorActions.strikethrough,
  },
  { type: "action", label: "Inline code", icon: CodeIcon, run: markdownEditorActions.inlineCode },
  { type: "divider", id: "after-inline" },
  { type: "action", label: "Bullet list", icon: ListIcon, run: markdownEditorActions.bulletList },
  {
    type: "action",
    label: "Numbered list",
    icon: ListOrderedIcon,
    run: markdownEditorActions.numberedList,
  },
  { type: "action", label: "Quote", icon: QuoteIcon, run: markdownEditorActions.quote },
  { type: "action", label: "Link", icon: LinkIcon, run: markdownEditorActions.link },
];

function EditorToolbar({
  viewRef,
  trailing,
}: {
  viewRef: { readonly current: EditorView | null };
  trailing?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-0.5 border-b border-border/40 px-2 py-1.5">
      {TOOLBAR_ACTIONS.map((action) =>
        action.type === "divider" ? (
          <span key={action.id} className="mx-1 h-4 w-px bg-border/60" />
        ) : (
          <Tooltip key={action.label}>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={action.label}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    const view = viewRef.current;
                    if (view !== null) action.run(view);
                  }}
                  className="t3-toolbar-button flex size-7 items-center justify-center rounded-md text-muted-foreground transition-all duration-100 hover:bg-accent/70 hover:text-foreground active:scale-90"
                >
                  <action.icon className="size-4" />
                </button>
              }
            />
            <TooltipPopup side="bottom">{action.label}</TooltipPopup>
          </Tooltip>
        ),
      )}
      <span className="ms-auto">{trailing}</span>
    </div>
  );
}
