import type { Directory, File } from "expo-file-system";

let tempFileSequence = 0;

export function isAtomicWriteTempFileName(name: string, targetFileName?: string): boolean {
  if (!name.endsWith(".tmp")) return false;
  const stagedName = name.slice(0, -".tmp".length);
  const separator = stagedName.lastIndexOf(".");
  if (separator < 1) return false;
  const sequence = stagedName.slice(separator + 1);
  if (!/^[1-9]\d*$/.test(sequence)) return false;
  return targetFileName === undefined || stagedName.slice(0, separator) === targetFileName;
}

/** Best-effort sweep for staging files left behind by a terminated JS process. */
export async function removeStaleAtomicWriteTempFiles(
  directory: Directory,
  targetFileName?: string,
): Promise<void> {
  try {
    const { File: FileConstructor } = await import("expo-file-system");
    for (const entry of directory.list()) {
      if (
        entry instanceof FileConstructor &&
        isAtomicWriteTempFileName(entry.name, targetFileName)
      ) {
        try {
          if (entry.exists) entry.delete();
        } catch (error) {
          console.warn("Failed to remove stale atomic-write staging file", entry.name, error);
        }
      }
    }
  } catch (error) {
    console.warn("Failed to inspect atomic-write staging files", error);
  }
}

/**
 * Replaces a file's contents through a sibling temp file and an overwriting
 * rename, so an interrupted write (app restart, process death) never leaves a
 * truncated document at the final path. Each write stages through its own
 * temp file so concurrent writers to the same destination cannot move or
 * clobber each other's staging file mid-flight.
 */
export async function writeFileAtomically(file: File, contents: string): Promise<void> {
  const { File: FileConstructor } = await import("expo-file-system");
  tempFileSequence += 1;
  const temp = new FileConstructor(file.parentDirectory, `${file.name}.${tempFileSequence}.tmp`);
  try {
    temp.create({ intermediates: true, overwrite: true });
    temp.write(contents);
    temp.moveSync(file, { overwrite: true });
  } catch (error) {
    try {
      if (temp.exists) {
        temp.delete();
      }
    } catch {
      // Preserve the original write failure; stale-temp cleanup is best effort.
    }
    throw error;
  }
}
