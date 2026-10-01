import { assert, describe, it } from "vite-plus/test";

import {
  escapeGitHubWorkflowCommand,
  parseReleaseTracingEnvironment,
  serializeReleaseTracingEnvironment,
} from "./load-release-tracing-env.mjs";

const validSource = [
  "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL=https://traces.example.test/v1/traces",
  "T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET=client",
  "T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN=token=value%25",
  "",
].join("\n");

describe("release tracing environment loader", () => {
  it("accepts exactly the canonical tracing keys and serializes their stable order", () => {
    const values = parseReleaseTracingEnvironment(validSource);
    assert.deepEqual(values, {
      T3CODE_RELAY_CLIENT_OTLP_TRACES_URL: "https://traces.example.test/v1/traces",
      T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET: "client",
      T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN: "token=value%25",
    });
    assert.equal(serializeReleaseTracingEnvironment(values), validSource);
  });

  it("rejects injected, duplicate, incomplete, and insecure entries", () => {
    assert.throws(
      () => parseReleaseTracingEnvironment(`${validSource}PATH=/tmp/bin\n`),
      /unexpected key/u,
    );
    assert.throws(
      () => parseReleaseTracingEnvironment(`${validSource}\u001b[31mFORGED=value\n`),
      /unexpected key/u,
    );
    assert.throws(
      () =>
        parseReleaseTracingEnvironment(
          `${validSource}T3CODE_RELAY_CLIENT_OTLP_TRACES_TOKEN=second\n`,
        ),
      /duplicate key/u,
    );
    assert.throws(
      () =>
        parseReleaseTracingEnvironment(
          "T3CODE_RELAY_CLIENT_OTLP_TRACES_URL=https://traces.example.test\n",
        ),
      /missing required key/u,
    );
    assert.throws(
      () => parseReleaseTracingEnvironment(validSource.replace("https://", "http://")),
      /must be HTTPS/u,
    );
    assert.throws(
      () =>
        parseReleaseTracingEnvironment(
          validSource.replace(
            "https://traces.example.test/v1/traces",
            "https://traces.example.test/v1/traces?token=secret",
          ),
        ),
      /must not contain credentials/u,
    );
    assert.throws(
      () =>
        parseReleaseTracingEnvironment(
          validSource.replace(
            "T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET=client",
            `T3CODE_RELAY_CLIENT_OTLP_TRACES_DATASET=${"a".repeat(1025)}`,
          ),
        ),
      /oversized value/u,
    );
  });

  it("escapes workflow-command metacharacters before masking", () => {
    assert.equal(escapeGitHubWorkflowCommand("a%b\r\nc"), "a%25b%0D%0Ac");
  });
});
