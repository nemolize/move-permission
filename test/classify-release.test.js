import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { classifyRelease } from "../.github/scripts/classify-release.mjs";

const SCRIPT = fileURLToPath(
  new URL("../.github/scripts/classify-release.mjs", import.meta.url),
);

describe("classifyRelease", () => {
  it.each([
    ["1.2.0", "", "latest", "latest"],
    ["1.2.0", "1.1.0", "latest", "latest"],
    ["1.2.0", "1.2.0", "latest", "latest"],
    ["1.1.1", "1.2.0", "backport", "backport"],
    ["1.2.0-beta.1", "1.1.0", "next", "prerelease"],
    ["1.0.0-beta.1", "", "next", "prerelease"],
  ])("classifies %s against latest %s", (version, latest, npmTag, kind) => {
    expect(classifyRelease(version, latest)).toEqual({ npmTag, kind });
  });

  it("rejects invalid release versions", () => {
    expect(() => classifyRelease("not-a-version", "1.2.0")).toThrow(
      "invalid release version",
    );
    expect(() => classifyRelease("1.2.0", "not-a-version")).toThrow(
      "invalid latest version",
    );
  });
});

describe("CLI output", () => {
  // The workflow reads these exact key names out of $GITHUB_OUTPUT, so a
  // rename here silently breaks tag selection.
  it("prints the keys the release workflow consumes", () => {
    expect(
      execFileSync("node", [SCRIPT, "1.1.1", "1.2.0"], { encoding: "utf8" }),
    ).toBe("npm_tag=backport\nkind=backport\n");
  });
});
