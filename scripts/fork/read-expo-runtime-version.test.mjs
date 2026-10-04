import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeProcess from "node:process";
import * as NodeURL from "node:url";

import { assert, describe, it } from "vite-plus/test";

import {
  EXPO_RUNTIME_KEY,
  parseBinaryPlist,
  readExpoRuntimeVersion,
  readXmlPlistString,
} from "./read-expo-runtime-version.mjs";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const helper = NodePath.resolve(here, "read-expo-runtime-version.mjs");
const runtime = "a21dfbf91ea34506691ef12e24f26e9ddb36b901";
// Python plistlib binary dump of EXUpdatesRuntimeVersion + EXUpdatesURL.
const BINARY_PLIST = Buffer.from(
  "YnBsaXN0MDDSAQIDBF8QF0VYVXBkYXRlc1J1bnRpbWVWZXJzaW9uXEVYVXBkYXRlc1VSTF8QKGEyMWRmYmY5MWVhMzQ1MDY2OTFlZjEyZTI0ZjI2ZTlkZGIzNmI5MDFfEBpodHRwczovL3UuZXhwby5kZXYvZXhhbXBsZQgNJzRfAAAAAAAAAQEAAAAAAAAABQAAAAAAAAAAAAAAAAAAAHw=",
  "base64",
);

function xmlPlist(value) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0"><dict>',
    `<key>${EXPO_RUNTIME_KEY}</key>`,
    `<string>${value}</string>`,
    "</dict></plist>",
    "",
  ].join("\n");
}

function runCli(input, args = []) {
  return NodeChildProcess.spawnSync(NodeProcess.execPath, [helper, ...args], {
    encoding: "buffer",
    input,
  });
}

describe("read Expo.plist runtime version", () => {
  it("reads EXUpdatesRuntimeVersion from an XML plist", () => {
    const xml = xmlPlist(runtime);
    assert.equal(readXmlPlistString(xml), runtime);
    assert.equal(readExpoRuntimeVersion(Buffer.from(xml, "utf8")), runtime);
  });

  it("reads EXUpdatesRuntimeVersion from a binary plist", () => {
    const parsed = parseBinaryPlist(BINARY_PLIST);
    assert.equal(parsed[EXPO_RUNTIME_KEY], runtime);
    assert.equal(parsed.EXUpdatesURL, "https://u.expo.dev/example");
    assert.equal(readExpoRuntimeVersion(BINARY_PLIST), runtime);
  });

  it("prints the runtime on stdout and fails closed on garbage", () => {
    const xml = runCli(Buffer.from(xmlPlist(runtime), "utf8"));
    assert.equal(xml.status, 0);
    assert.equal(xml.stdout.toString("utf8").trim(), runtime);

    const binary = runCli(BINARY_PLIST);
    assert.equal(binary.status, 0);
    assert.equal(binary.stdout.toString("utf8").trim(), runtime);

    const missing = runCli(Buffer.from("<plist></plist>", "utf8"));
    assert.notEqual(missing.status, 0);
    assert.equal(missing.stdout.toString("utf8").trim(), "");

    const empty = runCli(Buffer.alloc(0));
    assert.notEqual(empty.status, 0);
  });

  it("reads a plist file path the same way the submit gate pipes unzip", () => {
    const directory = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-expo-plist-"));
    try {
      const xmlPath = NodePath.join(directory, "Expo.plist");
      const binaryPath = NodePath.join(directory, "Expo.binary.plist");
      NodeFS.writeFileSync(xmlPath, xmlPlist(runtime));
      NodeFS.writeFileSync(binaryPath, BINARY_PLIST);
      const xml = NodeChildProcess.spawnSync(NodeProcess.execPath, [helper, xmlPath], {
        encoding: "utf8",
      });
      const binary = NodeChildProcess.spawnSync(NodeProcess.execPath, [helper, binaryPath], {
        encoding: "utf8",
      });
      assert.equal(xml.status, 0);
      assert.equal(xml.stdout.trim(), runtime);
      assert.equal(binary.status, 0);
      assert.equal(binary.stdout.trim(), runtime);
    } finally {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });
});
