import { expect, test } from "vitest";

import { classifyRelease } from "../.github/scripts/classify-release.mjs";

test.each([
  ["1.2.0", "", "latest", "latest"],
  ["1.2.0", "1.1.0", "latest", "latest"],
  ["1.2.0", "1.2.0", "latest", "latest"],
  ["1.1.1", "1.2.0", "backport", "backport"],
  ["1.2.0-beta.1", "1.1.0", "next", "prerelease"],
  ["1.0.0-beta.1", "", "next", "prerelease"],
])(
  "classifies %s against latest %s",
  (version, latestVersion, npmTag, kind) => {
    expect(classifyRelease(version, latestVersion)).toEqual({ npmTag, kind });
  },
);

test("rejects invalid release versions", () => {
  expect(() => classifyRelease("not-a-version", "1.2.0")).toThrow(
    "invalid release version",
  );
  expect(() => classifyRelease("1.2.0", "not-a-version")).toThrow(
    "invalid latest version",
  );
});
