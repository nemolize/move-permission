import { describe, expect, it } from "vitest";

import { layerColorizer } from "../src/color.ts";
import {
  formatBrokenLayers,
  formatEntries,
  promptForMoves,
} from "../src/interaction.ts";

const layer = (name, settings, writable = true) => ({
  name,
  path: `/tmp/${name}.json`,
  writable,
  exists: true,
  settings,
});

describe("interactive permission selection", () => {
  it("scopes entries and destinations to the selected writable source", async () => {
    const answers = ["2", "1", "1"];
    const prompts = [];
    const output = [];
    const moves = await promptForMoves(
      [
        layer("user", { permissions: { allow: ["Bash(*)"] } }),
        layer("project-local", { permissions: { allow: ["Bash(*)"] } }),
        layer("project", { permissions: { ask: ["Read(*)"] } }),
        layer("managed", { permissions: { ask: ["Read(*)"] } }, false),
      ],
      async (prompt) => {
        prompts.push(prompt);
        return answers.shift() ?? "";
      },
      (line) => output.push(line),
    );

    expect(prompts).toEqual([
      "Choose source scope (blank to cancel): ",
      "Select entry numbers (comma-separated, blank to cancel): ",
      "Choose destination: ",
    ]);
    expect(output).toEqual([
      "From scopes: 1. project-local (1 entries)  2. project (1 entries)",
      '1. permissions.ask "Read(*)" ⚠ also in managed',
      "Destinations: 1. user  2. project-local  0. delete",
    ]);
    expect(moves).toEqual([
      {
        source: { layer: "project", field: "ask", value: "Read(*)" },
        destination: "user",
      },
    ]);
  });

  it("reports nothing movable without prompting or listing user entries", async () => {
    const output = [];
    const moves = await promptForMoves(
      [
        layer("user", { permissions: { allow: ["Bash(user)"] } }),
        layer("user-local", { permissions: { deny: ["WebFetch(*)"] } }),
      ],
      async () => {
        throw new Error("must not prompt when there is no selectable source");
      },
      (line) => output.push(line),
    );

    expect(moves).toBeUndefined();
    expect(output).toEqual([
      "No permission entries in project or project-local settings to move.",
      "Run --list to see the entries in every layer.",
    ]);
  });

  it("cancels before displaying entries when no source is selected", async () => {
    const output = [];
    const moves = await promptForMoves(
      [layer("project", { permissions: { allow: ["Bash(*)"] } })],
      async () => "",
      (line) => output.push(line),
    );

    expect(moves).toBeUndefined();
    expect(output).toEqual([
      "From scopes: 1. project (1 entries)",
      "Cancelled.",
    ]);
  });

  it("cancels instead of treating a blank destination as delete", async () => {
    const answers = ["1", "1", ""];
    const output = [];
    const moves = await promptForMoves(
      [layer("project", { permissions: { allow: ["Bash(*)"] } })],
      async () => answers.shift() ?? "",
      (line) => output.push(line),
    );

    expect(moves).toBeUndefined();
    expect(output.at(-1)).toBe("Cancelled.");
  });

  it("reports broken layers with their parse error", () => {
    expect(
      formatBrokenLayers([
        {
          name: "user-local",
          path: "/tmp/settings.local.json",
          writable: false,
          exists: true,
          error: "contains invalid JSON: Unexpected token",
        },
        {
          name: "user",
          path: "/tmp/settings.json",
          writable: true,
          exists: true,
          settings: {},
        },
      ]),
    ).toEqual([
      "[user-local] /tmp/settings.local.json contains invalid JSON: Unexpected token (skipped)",
    ]);
  });

  it("wraps the layer label in ANSI colour when a colorizer is provided", () => {
    const [line = ""] = formatEntries(
      [{ layer: "user", field: "allow", value: "Bash(*)" }],
      { colorize: layerColorizer(true) },
    );
    // eslint-disable-next-line no-control-regex
    expect(line).toMatch(/\x1b\[\d+m\[user\]\x1b\[0m/);
  });

  it("wraps duplicate-layer notices in ANSI colour when a colorizer is provided", () => {
    const [line = ""] = formatEntries(
      [
        { layer: "user", field: "allow", value: "Bash(x)" },
        { layer: "project", field: "allow", value: "Bash(x)" },
      ],
      { colorize: layerColorizer(true) },
    );
    // eslint-disable-next-line no-control-regex
    expect(line).toMatch(/⚠ also in \x1b\[\d+mproject\x1b\[0m/);
  });

  it("propagates the colorizer through promptForMoves scope and destination lines", async () => {
    const answers = ["2", "1", "1"];
    const output = [];
    await promptForMoves(
      [
        layer("user", { permissions: { allow: ["Bash(*)"] } }),
        layer("project-local", { permissions: { allow: ["Bash(*)"] } }),
        layer("project", { permissions: { ask: ["Read(*)"] } }),
      ],
      async () => answers.shift() ?? "",
      (line) => output.push(line),
      layerColorizer(true),
    );
    const [scopesLine = "", , destinationsLine = ""] = output;
    /* eslint-disable no-control-regex */
    expect(scopesLine).toMatch(/\x1b\[\d+mproject-local\x1b\[0m/);
    expect(scopesLine).toMatch(/\x1b\[\d+mproject\x1b\[0m/);
    expect(destinationsLine).toMatch(/\x1b\[\d+muser\x1b\[0m/);
    /* eslint-enable no-control-regex */
  });

  it("wraps the broken layer label in ANSI colour when a colorizer is provided", () => {
    const [line = ""] = formatBrokenLayers(
      [
        {
          name: "user-local",
          path: "/tmp/settings.local.json",
          writable: false,
          exists: true,
          error: "contains invalid JSON: Unexpected token",
        },
      ],
      layerColorizer(true),
    );
    // eslint-disable-next-line no-control-regex
    expect(line).toMatch(/^\x1b\[\d+m\[user-local\]\x1b\[0m /);
  });

  it("keeps the unified layer labels used by list mode", () => {
    expect(
      formatEntries([
        { layer: "user", field: "allow", value: "Bash(*)" },
        { layer: "managed", field: "deny", value: "WebFetch(*)" },
      ]),
    ).toEqual([
      '1. [user] permissions.allow "Bash(*)"',
      '2. [managed] permissions.deny "WebFetch(*)"',
    ]);
  });
});
