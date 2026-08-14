import { assert, describe, it } from "@effect/vitest";

import { iterateTarEntries, listTarGzEntries } from "./Untar.ts";
import {
  gnuLongName,
  paxExtendedHeader,
  tarArchive,
  tarDirectory,
  tarFile,
  tarFileWithPrefix,
  tarGzArchive,
} from "./testUtils/tarballFixture.ts";

describe("iterateTarEntries", () => {
  it("iterates regular files with their contents", () => {
    const archive = tarGzArchive(
      tarDirectory("repo-abc123/"),
      tarFile("repo-abc123/README.md", "# hello\n"),
      tarFile("repo-abc123/skills/tdd/SKILL.md", "---\nname: tdd\n---\n"),
    );

    const entries = listTarGzEntries(archive);

    assert.deepStrictEqual(
      entries.map((entry) => [entry.name, entry.type] as const),
      [
        ["repo-abc123/", "directory"],
        ["repo-abc123/README.md", "file"],
        ["repo-abc123/skills/tdd/SKILL.md", "file"],
      ],
    );
    assert.strictEqual(new TextDecoder().decode(entries[2]?.data), "---\nname: tdd\n---\n");
  });

  it("honors a pax path override for the following entry", () => {
    const longPath = `repo-abc123/${"nested/".repeat(30)}SKILL.md`;
    const archive = tarGzArchive(
      paxExtendedHeader({ path: longPath }),
      tarFile("repo-abc123/short", "contents"),
    );

    const entries = listTarGzEntries(archive);

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]?.name, longPath);
    assert.strictEqual(entries[0]?.type, "file");
    assert.strictEqual(new TextDecoder().decode(entries[0]?.data), "contents");
  });

  it("honors a GNU longname for the following entry", () => {
    const longPath = `repo-abc123/${"deep/".repeat(30)}SKILL.md`;
    const archive = tarGzArchive(gnuLongName(longPath), tarFile("repo-abc123/short", "x"));

    const entries = listTarGzEntries(archive);

    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0]?.name, longPath);
  });

  it("joins ustar prefix and name fields", () => {
    const archive = tarGzArchive(tarFileWithPrefix("repo-abc123/skills", "tdd/SKILL.md", "body"));

    const entries = listTarGzEntries(archive);

    assert.strictEqual(entries[0]?.name, "repo-abc123/skills/tdd/SKILL.md");
  });

  it("stops at the terminating zero blocks", () => {
    const archive = tarArchive(tarFile("repo-abc123/a.txt", "a"));
    const entries = [...iterateTarEntries(archive)];

    assert.strictEqual(entries.length, 1);
  });
});
