import type { LucideIcon } from "lucide-react";
import {
  AlarmClockOffIcon,
  ArchiveIcon,
  CheckIcon,
  ClipboardPasteIcon,
  ClockIcon,
  CopyIcon,
  FolderIcon,
  GitBranchIcon,
  HashIcon,
  ImageIcon,
  LinkIcon,
  MailIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  RefreshCwIcon,
  ScissorsIcon,
  TextSelectIcon,
  Trash2Icon,
  Undo2Icon,
} from "lucide-react";

const CONTEXT_MENU_ICONS = {
  "alarm-off": AlarmClockOffIcon,
  archive: ArchiveIcon,
  check: CheckIcon,
  "clipboard-paste": ClipboardPasteIcon,
  clock: ClockIcon,
  copy: CopyIcon,
  folder: FolderIcon,
  "git-branch": GitBranchIcon,
  hash: HashIcon,
  image: ImageIcon,
  link: LinkIcon,
  mail: MailIcon,
  pencil: PencilIcon,
  pin: PinIcon,
  "pin-off": PinOffIcon,
  refresh: RefreshCwIcon,
  scissors: ScissorsIcon,
  "text-select": TextSelectIcon,
  trash: Trash2Icon,
  undo: Undo2Icon,
} as const satisfies Record<string, LucideIcon>;

export type ContextMenuIconName = keyof typeof CONTEXT_MENU_ICONS;

export function contextMenuIcon(name: string | undefined): LucideIcon | null {
  if (name === undefined) return null;
  return CONTEXT_MENU_ICONS[name as ContextMenuIconName] ?? null;
}
