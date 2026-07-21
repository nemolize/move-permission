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

The command discovers the project root from the current directory and reads `permissions.allow`, `permissions.ask`, and `permissions.deny` from every accessible layer. Interactive runs first prompt for a source scope and then show only entries from that scope. `--list` prints the unified list without modifying settings. Select entries, then move them to a writable destination or delete them.

Before writing, it previews touched files and asks for confirmation. Every modified settings file is backed up as `<file>.bak.<epoch>`, written through a temporary file, synced, renamed, and parsed again before use.

Layer labels in `--list` and interactive prompts are colour-coded when the output stream is a terminal. Set `NO_COLOR=1` (or `FORCE_COLOR=0` / `FORCE_COLOR=false`) to disable, or `FORCE_COLOR=1` to force colour when piping.

`managed-settings.json` is included in `--list` output when present but cannot be selected as an interactive source or destination. Interactive entries still note duplicates found in managed settings. A settings file with invalid JSON is reported on stderr and skipped (treated as read-only for this run) so the remaining layers can still be listed and modified.
