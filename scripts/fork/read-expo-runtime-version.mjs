#!/usr/bin/env node
// Cross-platform Expo.plist reader for the TestFlight submit gate.
// Windows agents have no macOS plutil; this extracts EXUpdatesRuntimeVersion
// from XML or binary plists on stdin (or a file path).
import * as NodeFS from "node:fs";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";
import * as NodePath from "node:path";

export const EXPO_RUNTIME_KEY = "EXUpdatesRuntimeVersion";
export const MAX_PLIST_BYTES = 1024 * 1024;

function decodeXmlEntities(value) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

export function stripBom(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return buffer.subarray(3);
  }
  return buffer;
}

export function readXmlPlistString(xml, key = EXPO_RUNTIME_KEY) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`<key>${escaped}</key>\\s*<string>([^<]*)</string>`, "u").exec(xml);
  if (!match) return "";
  return decodeXmlEntities(match[1]).trim();
}

function readSizedInt(buffer, offset, size) {
  if (size === 1) return buffer.readUInt8(offset);
  if (size === 2) return buffer.readUInt16BE(offset);
  if (size === 4) return buffer.readUInt32BE(offset);
  if (size === 8) {
    const value = buffer.readBigUInt64BE(offset);
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("binary plist integer exceeded a safe index");
    }
    return Number(value);
  }
  throw new Error(`unsupported binary plist integer width ${size}`);
}

function decodeUtf16Be(buffer) {
  const units = [];
  for (let index = 0; index + 1 < buffer.length; index += 2) {
    units.push(buffer.readUInt16BE(index));
  }
  return String.fromCharCode(...units);
}

export function parseBinaryPlist(buffer) {
  if (buffer.length < 40 || buffer.subarray(0, 8).toString("ascii") !== "bplist00") {
    throw new Error("not a binary plist");
  }
  const trailer = buffer.subarray(buffer.length - 32);
  const offsetSize = trailer[6];
  const refSize = trailer[7];
  const objectCount = Number(trailer.readBigUInt64BE(8));
  const topObject = Number(trailer.readBigUInt64BE(16));
  const offsetTableOffset = Number(trailer.readBigUInt64BE(24));
  if (
    offsetSize < 1 ||
    offsetSize > 8 ||
    refSize < 1 ||
    refSize > 8 ||
    objectCount < 1 ||
    objectCount > 100_000 ||
    topObject < 0 ||
    topObject >= objectCount ||
    offsetTableOffset < 8 ||
    offsetTableOffset + objectCount * offsetSize > buffer.length - 32
  ) {
    throw new Error("binary plist trailer is invalid");
  }

  const objectOffset = (index) => {
    const tableOffset = offsetTableOffset + index * offsetSize;
    const offset = readSizedInt(buffer, tableOffset, offsetSize);
    if (offset < 8 || offset >= buffer.length - 32) {
      throw new Error("binary plist object offset is out of range");
    }
    return offset;
  };

  const cache = new Map();

  const parseObject = (index) => {
    if (cache.has(index)) return cache.get(index);
    if (index < 0 || index >= objectCount) {
      throw new Error("binary plist object reference is out of range");
    }
    let pos = objectOffset(index);
    const marker = buffer[pos];
    pos += 1;
    const type = marker >> 4;
    let info = marker & 0x0f;

    const readLength = () => {
      if (info !== 0x0f) return info;
      const sizeMarker = buffer[pos];
      pos += 1;
      const size = 1 << (sizeMarker & 0x0f);
      const length = readSizedInt(buffer, pos, size);
      pos += size;
      return length;
    };

    let value;
    switch (type) {
      case 0x0:
        value = info === 0x8 ? false : info === 0x9 ? true : null;
        break;
      case 0x1: {
        const size = 1 << info;
        value =
          size === 8 ? buffer.readBigInt64BE(pos).toString() : readSizedInt(buffer, pos, size);
        break;
      }
      case 0x4: {
        const length = readLength();
        value = buffer.subarray(pos, pos + length);
        break;
      }
      case 0x5: {
        const length = readLength();
        value = buffer.subarray(pos, pos + length).toString("ascii");
        break;
      }
      case 0x6: {
        const length = readLength();
        value = decodeUtf16Be(buffer.subarray(pos, pos + length * 2));
        break;
      }
      case 0x7: {
        const length = readLength();
        value = buffer.subarray(pos, pos + length).toString("utf8");
        break;
      }
      case 0xa: {
        const length = readLength();
        const refs = [];
        for (let item = 0; item < length; item += 1) {
          refs.push(readSizedInt(buffer, pos + item * refSize, refSize));
        }
        value = refs.map((ref) => parseObject(ref));
        break;
      }
      case 0xd: {
        const length = readLength();
        const dict = {};
        for (let item = 0; item < length; item += 1) {
          const key = parseObject(readSizedInt(buffer, pos + item * refSize, refSize));
          const entry = parseObject(readSizedInt(buffer, pos + (length + item) * refSize, refSize));
          if (typeof key === "string") dict[key] = entry;
        }
        value = dict;
        break;
      }
      default:
        throw new Error(`unsupported binary plist object type 0x${type.toString(16)}`);
    }
    cache.set(index, value);
    return value;
  };

  return parseObject(topObject);
}

export function readExpoRuntimeVersion(input, key = EXPO_RUNTIME_KEY) {
  if (!Buffer.isBuffer(input) || input.length === 0 || input.length > MAX_PLIST_BYTES) {
    return "";
  }
  const buffer = stripBom(input);
  if (buffer.subarray(0, 8).toString("ascii") === "bplist00") {
    try {
      const parsed = parseBinaryPlist(buffer);
      const value = parsed && typeof parsed === "object" ? parsed[key] : "";
      return typeof value === "string" ? value.trim() : "";
    } catch {
      return "";
    }
  }
  const xml = buffer.toString("utf8");
  if (!xml.includes("<plist") && !xml.includes("<key>")) return "";
  return readXmlPlistString(xml, key);
}

function readStdinOrFile(argv = NodeProcess.argv.slice(2)) {
  if (argv[0] && argv[0] !== "-") {
    const stat = NodeFS.statSync(argv[0]);
    if (stat.size > MAX_PLIST_BYTES) return Buffer.alloc(0);
    return NodeFS.readFileSync(argv[0]);
  }
  const chunks = [];
  let length = 0;
  let bytes;
  try {
    bytes = NodeFS.readFileSync(0);
  } catch {
    return Buffer.alloc(0);
  }
  if (bytes.length > MAX_PLIST_BYTES) return Buffer.alloc(0);
  chunks.push(bytes);
  length += bytes.length;
  return Buffer.concat(chunks, length);
}

function main() {
  const value = readExpoRuntimeVersion(readStdinOrFile());
  if (!value) NodeProcess.exit(1);
  NodeProcess.stdout.write(`${value}\n`);
}

const invokedAsMain =
  Boolean(NodeProcess.argv[1]) &&
  import.meta.url === NodeURL.pathToFileURL(NodePath.resolve(NodeProcess.argv[1])).href;
if (invokedAsMain) {
  main();
}
