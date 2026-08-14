// @effect-diagnostics nodeBuiltinImport:off
/**
 * Tiny ustar writer for tests: just enough to build archives the `Untar`
 * reader and the skill marketplace must understand, including pax extended
 * headers and GNU longname entries.
 */
import * as NodeZlib from "node:zlib";

const BLOCK_SIZE = 512;
const textEncoder = new TextEncoder();

function writeString(block: Uint8Array, start: number, value: string, length: number): void {
  const bytes = textEncoder.encode(value);
  block.set(bytes.subarray(0, Math.min(bytes.byteLength, length)), start);
}

function writeOctal(block: Uint8Array, start: number, value: number, length: number): void {
  writeString(block, start, value.toString(8).padStart(length - 1, "0"), length - 1);
}

function headerBlock(input: {
  readonly name: string;
  readonly size: number;
  readonly typeflag: string;
  readonly prefix?: string;
}): Uint8Array {
  const block = new Uint8Array(BLOCK_SIZE);
  writeString(block, 0, input.name, 100);
  writeOctal(block, 100, 0o644, 8);
  writeOctal(block, 124, input.size, 12);
  writeOctal(block, 136, 0, 12);
  block.fill(0x20, 148, 156);
  writeString(block, 156, input.typeflag, 1);
  writeString(block, 257, "ustar\0", 6);
  writeString(block, 263, "00", 2);
  if (input.prefix !== undefined) {
    writeString(block, 345, input.prefix, 155);
  }
  let checksum = 0;
  for (const byte of block) {
    checksum += byte;
  }
  writeString(block, 148, `${checksum.toString(8).padStart(6, "0")}\0 `, 8);
  return block;
}

function dataBlocks(data: Uint8Array): Uint8Array {
  const padded = new Uint8Array(Math.ceil(Math.max(data.byteLength, 1) / BLOCK_SIZE) * BLOCK_SIZE);
  padded.set(data);
  return padded;
}

/** A regular file entry. */
export function tarFile(name: string, contents: string): Uint8Array {
  const data = textEncoder.encode(contents);
  return concatBlocks(
    headerBlock({ name, size: data.byteLength, typeflag: "0" }),
    dataBlocks(data),
  );
}

/** A directory entry. */
export function tarDirectory(name: string): Uint8Array {
  return headerBlock({ name, size: 0, typeflag: "5" });
}

/**
 * A pax extended header (`x`) carrying the given records, e.g.
 * `paxExtendedHeader({ path: "very/long/name" })`; applies to the next entry.
 */
export function paxExtendedHeader(records: Readonly<Record<string, string>>): Uint8Array {
  const parts = Object.entries(records).map(([key, value]) => {
    const body = `${key}=${value}\n`;
    let length = body.length + 2;
    while (`${length} ${body}`.length !== length) {
      length += 1;
    }
    return `${length} ${body}`;
  });
  const data = textEncoder.encode(parts.join(""));
  return concatBlocks(
    headerBlock({ name: "PaxHeaders.0/x", size: data.byteLength, typeflag: "x" }),
    dataBlocks(data),
  );
}

/** A GNU longname entry (`L`) naming the next entry. */
export function gnuLongName(name: string): Uint8Array {
  const data = textEncoder.encode(`${name}\0`);
  return concatBlocks(
    headerBlock({ name: "././@LongLink", size: data.byteLength, typeflag: "L" }),
    dataBlocks(data),
  );
}

/** A file entry stored with a split ustar prefix/name pair. */
export function tarFileWithPrefix(prefix: string, name: string, contents: string): Uint8Array {
  const data = textEncoder.encode(contents);
  return concatBlocks(
    headerBlock({ name, size: data.byteLength, typeflag: "0", prefix }),
    dataBlocks(data),
  );
}

function concatBlocks(...parts: ReadonlyArray<Uint8Array>): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

/** Concatenate entries and terminate the archive with two zero blocks. */
export function tarArchive(...entries: ReadonlyArray<Uint8Array>): Uint8Array {
  return concatBlocks(...entries, new Uint8Array(BLOCK_SIZE * 2));
}

/** Build a gzipped archive, like the codeload tarballs the marketplace reads. */
export function tarGzArchive(...entries: ReadonlyArray<Uint8Array>): Uint8Array {
  return NodeZlib.gzipSync(tarArchive(...entries));
}
