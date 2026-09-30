import * as NodeModule from "node:module";

import { assert, describe, it } from "vite-plus/test";

const require = NodeModule.createRequire(import.meta.url);
const { CRASH_SIGNATURE, MARKER, softFailUpdatesErrorRecovery } = require(
  "./withIosSoftFailUpdatesRecovery.cjs",
);

// SDK 57 crash() body from expo-updates ErrorRecovery.swift. The plugin
// must keep matching this signature so a silent Expo bump cannot ship the
// throwException abort again.
const EXPO_SDK_57_CRASH = `  private func crash() {
    // create new exception object from stack of errors
    // use the initial error and put the rest into userInfo
    let initialError = encounteredErrors.first!
    encounteredErrors.remove(at: 0)

    if let initialError = initialError as? NSError,
      let previousFatalErrorHandler = previousFatalErrorHandler {
      previousFatalErrorHandler(initialError)
    } else if let initialError = initialError as? NSException,
      let previousFatalExceptionHandler = previousFatalExceptionHandler {
      previousFatalExceptionHandler(initialError)
    }

    var name: NSExceptionName
    var reason: String?
    var userInfo: [AnyHashable: Any]
    if let initialError = initialError as? NSError {
      name = NSExceptionName(rawValue: "\\(RCTFatalExceptionName): \\(initialError.localizedDescription)")
      reason = RCTFormatError(initialError.localizedDescription, (initialError.userInfo[RCTJSStackTraceKey] as? [[String: Any]]), 175)
      userInfo = initialError.userInfo
    } else if let initialError = initialError as? NSException {
      name = initialError.name
      reason = initialError.reason
      userInfo = initialError.userInfo ?? [:]
    } else {
      preconditionFailure("Shouldn't add object types other than NSError or NSException to encounteredErrors")
    }

    userInfo["EXUpdatesLaterEncounteredErrors"] = encounteredErrors
    delegate?.throwException(NSException(name: name, reason: reason, userInfo: userInfo))
  }
`;

describe("withIosSoftFailUpdatesRecovery", () => {
  it("returns from crash() before Expo re-raises the captured fatal", () => {
    const patched = softFailUpdatesErrorRecovery(EXPO_SDK_57_CRASH);
    const crashBody = patched.slice(patched.indexOf(CRASH_SIGNATURE) + CRASH_SIGNATURE.length);
    const returnIndex = crashBody.indexOf("return");
    const throwIndex = crashBody.indexOf("throwException");

    assert.include(patched, MARKER);
    assert.isAtLeast(returnIndex, 0);
    assert.isAtLeast(throwIndex, 0);
    assert.isBelow(returnIndex, throwIndex);
  });

  it("is idempotent across repeated prebuilds", () => {
    const patched = softFailUpdatesErrorRecovery(EXPO_SDK_57_CRASH);
    assert.equal(softFailUpdatesErrorRecovery(patched), patched);
  });

  it("fails visibly when Expo renames crash()", () => {
    assert.throws(
      () => softFailUpdatesErrorRecovery("public final class ErrorRecovery {}"),
      /ErrorRecovery.crash/,
    );
  });
});
