import { assert, it } from "@effect/vitest";

import {
  FORK_CLI_INSTALL_SCRIPT_URL,
  FORK_CLI_TARBALL_FEED_URL,
  forkCliCommand,
  forkCliTarballFileName,
  forkCliTarballUrl,
} from "./connectBranding.ts";

it("names versioned CLI tarballs without decoding fork builds to upstream", () => {
  assert.equal(forkCliTarballFileName(), "t3.tgz");
  assert.equal(forkCliTarballFileName("0.0.34"), "t3-0.0.34.tgz");
  assert.equal(
    forkCliTarballFileName("0.0.33-nightly.20260809.1042000012"),
    "t3-0.0.33-nightly.20260809.1042000012.tgz",
  );
  assert.equal(
    forkCliTarballUrl("0.0.33-nightly.20260809.1042000012"),
    `${FORK_CLI_TARBALL_FEED_URL}/t3-0.0.33-nightly.20260809.1042000012.tgz`,
  );
});

it("prints an npx command that installs this fork, not npm t3", () => {
  assert.equal(
    forkCliCommand("service update", "0.0.34"),
    `npx --yes --package ${FORK_CLI_TARBALL_FEED_URL}/t3-0.0.34.tgz t3 service update`,
  );
  assert.equal(forkCliCommand(), `npx --yes --package ${FORK_CLI_TARBALL_FEED_URL}/t3.tgz t3`);
  assert.equal(FORK_CLI_INSTALL_SCRIPT_URL, `${FORK_CLI_TARBALL_FEED_URL}/install.sh`);
});
