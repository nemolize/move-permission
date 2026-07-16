import { describe, expect, it } from "vitest";

import { formatEntries, promptForMoves } from "../src/interaction.ts";

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
      "From scopes: 1. user (1 entries)  2. project (1 entries)",
      '1. permissions.ask "Read(*)" ⚠ also in managed',
      "Destinations: 1. user  0. delete",
    ]);
    expect(moves).toEqual([
      {
        source: { layer: "project", field: "ask", value: "Read(*)" },
        destination: "user",
      },
    ]);
  });

  it("cancels before displaying entries when no source is selected", async () => {
    const output = [];
    const moves = await promptForMoves(
      [layer("user", { permissions: { allow: ["Bash(*)"] } })],
      async () => "",
      (line) => output.push(line),
    );

    expect(moves).toBeUndefined();
    expect(output).toEqual(["From scopes: 1. user (1 entries)", "Cancelled."]);
  });

  it("cancels instead of treating a blank destination as delete", async () => {
    const answers = ["1", "1", ""];
    const output = [];
    const moves = await promptForMoves(
      [layer("user", { permissions: { allow: ["Bash(*)"] } })],
      async () => answers.shift() ?? "",
      (line) => output.push(line),
    );

    expect(moves).toBeUndefined();
    expect(output.at(-1)).toBe("Cancelled.");
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
