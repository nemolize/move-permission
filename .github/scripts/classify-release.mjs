import { pathToFileURL } from "node:url";

import { lt, prerelease, valid } from "semver";

/**
 * Decides how a release version should be tagged. An empty `latestVersion`
 * means the package has no `latest` dist-tag to compare against.
 *
 * Returns a `kind` of `prerelease` | `backport` | `latest` — the caller maps
 * it to CLI flags.
 */
export const classifyRelease = (version, latestVersion = "") => {
  if (valid(version) === null) {
    throw new Error(`invalid release version: ${version}`);
  }

  if (prerelease(version) !== null) {
    return { npmTag: "next", kind: "prerelease" };
  }

  if (latestVersion !== "" && valid(latestVersion) === null) {
    throw new Error(`invalid latest version: ${latestVersion}`);
  }

  if (latestVersion !== "" && lt(version, latestVersion)) {
    return { npmTag: "backport", kind: "backport" };
  }

  return { npmTag: "latest", kind: "latest" };
};

const isMain =
  process.argv[1] !== undefined &&
  pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  const [version, latestVersion = ""] = process.argv.slice(2);
  if (version === undefined) {
    throw new Error("usage: classify-release.mjs <version> [latest-version]");
  }

  const { npmTag, kind } = classifyRelease(version, latestVersion);
  process.stdout.write(`npm_tag=${npmTag}\nkind=${kind}\n`);
}
