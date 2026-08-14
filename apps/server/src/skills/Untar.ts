// @effect-diagnostics nodeBuiltinImport:off
/**
 * Untar — minimal dependency-free ustar reader used to browse and extract
 * GitHub marketplace tarballs (`codeload.github.com/<owner>/<repo>/tar.gz`).
 *
 * Handles the two long-name mechanisms those archives actually use: pax
 * extended headers (`x` entries, `path=` records) and GNU longname entries
 * (`L`). Only regular files carry contents; every other typeflag surfaces as
 * `"directory"`/`"other"` metadata so callers can skip it.
 *
 * @module skills/Untar
 */
import * as NodeZlib from "node:zlib";

export interface TarEntry {
  /** Entry path with ustar prefixes and pax/GNU long-name overrides applied. */
  readonly name: string;
  readonly type: "file" | "directory" | "other";
  /** File bytes; empty for non-file entries. */
  readonly data: Uint8Array;
}

const BLOCK_SIZE = 512;
const textDecoder = new TextDecoder();

function readString(block: Uint8Array, start: number, length: number): string {
  const end = block.indexOf(0, start);
  const stop = end === -1 || end > start + length ? start + length : end;
  return textDecoder.decode(block.subarray(start, stop));
}

function readOctal(block: Uint8Array, start: number, length: number): number {
  const field = readString(block, start, length).trim();
  const value = Number.parseInt(field, 8);
  if (Number.isNaN(value)) {
    throw new Error("Malformed tar header: non-octal numeric field.");
  }
  return value;
}

function isZeroBlock(block: Uint8Array): boolean {
  for (const byte of block) {
    if (byte !== 0) return false;
  }
  return true;
}

/** Parse a pax extended header body into its key=value records. */
function parsePaxRecords(data: Uint8Array): ReadonlyArray<readonly [string, string]> {
  const records: Array<readonly [string, string]> = [];
  let offset = 0;
  while (offset < data.byteLength) {
    const spaceIndex = data.indexOf(0x20, offset);
    if (spaceIndex === -1) break;
    const lengthText = textDecoder.decode(data.subarray(offset, spaceIndex));
    const length = Number.parseInt(lengthText, 10);
    if (Number.isNaN(length) || length <= 0 || offset + length > data.byteLength) {
      break;
    }
    const record = textDecoder.decode(data.subarray(spaceIndex + 1, offset + length - 1));
    const equalsIndex = record.indexOf("=");
    if (equalsIndex !== -1) {
      records.push([record.slice(0, equalsIndex), record.slice(equalsIndex + 1)]);
    }
    offset += length;
  }
  return records;
}

/**
 * Iterate the entries of a plain (already decompressed) tar archive.
 * Throws on malformed headers; the two zero blocks ending an archive stop
 * iteration without an error.
 */
export function* iterateTarEntries(bytes: Uint8Array): Generator<TarEntry> {
  let offset = 0;
  // Name overrides carried by metadata entries that precede the entry they
  // describe (pax `path=` wins over a GNU longname when both appear).
  let pendingName: string | undefined;

  while (offset + BLOCK_SIZE <= bytes.byteLength) {
    const header = bytes.subarray(offset, offset + BLOCK_SIZE);
    if (isZeroBlock(header)) {
      return;
    }

    const size = readOctal(header, 124, 12);
    const typeflag = String.fromCharCode(header[156] ?? 0x30);
    const prefix = readString(header, 345, 155);
    let name = readString(header, 0, 100);
    if (prefix.length > 0) {
      name = `${prefix}/${name}`;
    }
    const dataStart = offset + BLOCK_SIZE;
    const dataEnd = dataStart + size;
    if (dataEnd > bytes.byteLength) {
      throw new Error("Malformed tar archive: entry data extends past the archive end.");
    }
    const data = bytes.subarray(dataStart, dataEnd);
    offset = dataStart + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE;

    switch (typeflag) {
      case "x": {
        for (const [key, value] of parsePaxRecords(data)) {
          if (key === "path") {
            pendingName = value;
          }
        }
        continue;
      }
      case "g":
        // Pax global headers carry no per-entry overrides.
        continue;
      case "L": {
        pendingName = readString(data, 0, data.byteLength);
        continue;
      }
      case "0":
      case "\0":
      case "7":
        yield { name: pendingName ?? name, type: "file", data };
        break;
      case "5":
        yield { name: pendingName ?? name, type: "directory", data: new Uint8Array(0) };
        break;
      default:
        yield { name: pendingName ?? name, type: "other", data: new Uint8Array(0) };
        break;
    }
    pendingName = undefined;
  }
}

/** Decompress a `.tar.gz` buffer and return every entry. */
export function listTarGzEntries(gzipped: Uint8Array): Array<TarEntry> {
  return [...iterateTarEntries(NodeZlib.gunzipSync(gzipped))];
}
