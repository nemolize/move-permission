# move-permission

Interactive CLI to move Claude Code permission entries between user, user-local, project, and project-local settings layers.

```sh
npx move-permission
npx move-permission --list
npx move-permission --dry-run
```

## Run locally

This repository pins Node.js and pnpm through [mise](https://mise.jdx.dev/).

```sh
mise install
pnpm install --frozen-lockfile
pnpm run build

# Show command options
pnpm start -- --help

# Interactive mode
pnpm start

# List entries without modifying settings
pnpm start -- --list

# Preview a selected move without writing files
pnpm start -- --dry-run
```

The command discovers the project root from the current directory and reads `permissions.allow`, `permissions.ask`, and `permissions.deny` from every accessible layer. On a TTY the interactive run opens a full-screen picker (↑/↓ to move, space to toggle, `a` to toggle all currently visible entries, `/` to filter, Enter to confirm, Esc / `q` to cancel); on a non-TTY stream it falls back to a line-based prompt where entries are selected by comma-separated numbers. `--list` prints the unified list without modifying settings. Select entries, then move them to a writable destination or delete them.

Before writing, it previews touched files and asks for confirmation. Every modified settings file is backed up as `<file>.bak.<epoch>`, written through a temporary file, synced, renamed, and parsed again before use.

Layer labels in `--list` and interactive prompts are colour-coded when the output stream is a terminal. Set `NO_COLOR=1` (or `FORCE_COLOR=0` / `FORCE_COLOR=false`) to disable, or `FORCE_COLOR=1` to force colour when piping.

Only the `project` and `project-local` layers can be selected as a move source. User-level entries are still listed and remain available as destinations, so entries can be pushed up from a project layer to `user` or `user-local`, but not moved out of them. When no project layer holds any entry, the run reports that there is nothing to move and exits without prompting; use `--list` to see the entries in every layer.

`managed-settings.json` is included in `--list` output when present but cannot be selected as an interactive source or destination. Interactive entries still note duplicates found in managed settings. A settings file with invalid JSON is reported on stderr and skipped (treated as read-only for this run) so the remaining layers can still be listed and modified.

## Releasing

Pushing a `v*.*.*` tag runs `.github/workflows/release.yml`, which re-runs lint, build, and tests, publishes to npm, and creates a GitHub Release. The tag must match `version` in `package.json` or the workflow fails before publishing.

npm authentication uses [Trusted Publishing](https://docs.npmjs.com/trusted-publishers) (OIDC), so no `NPM_TOKEN` secret is stored. Two one-time setup steps are required before the first tagged release:

1. **Publish the initial version manually.** npm only exposes trusted-publisher settings on a package that already exists, and it has no pending-publisher mechanism for unpublished names ([npm/cli#8544](https://github.com/npm/cli/issues/8544)). Run `pnpm run build && pnpm publish` once with a granular access token.
2. **Register the trusted publisher.** On npmjs.com, open the package's Settings → Trusted publishing and add this repository with workflow `release.yml`. Every later release then publishes over OIDC.

Release the first version under a stable tag (`v0.1.0`, not `v0.1.0-beta.0`). A prerelease tag publishes under the `next` dist-tag, which would leave the package with no `latest` and break plain `npx move-permission` until a stable version ships.
