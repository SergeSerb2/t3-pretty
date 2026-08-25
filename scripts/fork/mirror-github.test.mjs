import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { assert, it } from "@effect/vitest";

const here = NodePath.dirname(NodeURL.fileURLToPath(import.meta.url));
const script = NodeFS.readFileSync(NodePath.resolve(here, "mirror-github.sh"), "utf8");
const pipeline = NodeFS.readFileSync(
  NodePath.resolve(here, "../../.buildkite/pipeline.yml"),
  "utf8",
);
it("uses a guarded, one-way public mirror", () => {
  assert.match(script, /GITHUB_MIRROR_SSH_KEY/);
  assert.match(script, /archive\/pre-origin-migration-2026-08-23/);
  assert.match(script, /GitHub main diverged from Origin/);
  assert.match(script, /BUILDKITE_BRANCH/);
  assert.match(script, /SergeSerb2\/t3-pretty/);
  assert.match(script, /force-with-lease/);
  assert.match(script, /push --no-thin/);
  assert.match(
    script,
    /if \[\[ "\$\(git rev-parse --is-shallow-repository\)" == true \]\]; then\s+git fetch --unshallow origin main\s+fi\s+git merge-base --is-ancestor/,
  );
  assert.match(script, /--force-with-lease="refs\/heads\/\$archive_branch:"/);
  NodeAssert.doesNotMatch(
    script,
    /--force-with-lease="refs\/heads\/\$archive_branch:\$github_tip"/,
  );
  assert.match(script, /refs\/heads\/main/);
  assert.match(script, /push --no-thin github "refs\/tags/);
  assert.match(script, /release_tag_pattern/);
  assert.match(script, /GITHUB_MIRROR_REPO.*SergeSerb2\/t3-pretty/);
  assert.match(script, /git remote set-url github/);
  assert.match(script, /git status --porcelain/);
  NodeAssert.doesNotMatch(script, /git fetch github main --tags/);
  NodeAssert.doesNotMatch(script, /git diff --quiet/);
  NodeAssert.doesNotMatch(script, /refs\/heads\/\*/);
  NodeAssert.doesNotMatch(pipeline, /test -n "\$\{GITHUB_MIRROR_SSH_KEY/);
  assert.match(pipeline, /load-buildkite-secrets\.sh GITHUB_MIRROR_SSH_KEY/);
  assert.match(script, /GITHUB_MIRROR_SSH_KEY:\?/);
});
