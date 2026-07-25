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
