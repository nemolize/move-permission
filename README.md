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

The command discovers the project root from the current directory, reads `permissions.allow`, `permissions.ask`, and `permissions.deny` from every accessible layer, and shows one unified list. Select entries, then move them to a writable destination or delete them.

Before writing, it previews touched files and asks for confirmation. Every modified settings file is backed up as `<file>.bak.<epoch>`, written through a temporary file, synced, renamed, and parsed again before use.

`managed-settings.json` is displayed when present but is never a destination. Invalid JSON in any accessible settings file stops the command rather than risking an overwrite.
