import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  applyMoves,
  changedLayers,
  entriesForLayers,
  loadLayer,
  renderSettings,
  writeLayersAtomically,
} from "../src/settings.ts";

const layer = (name, path, settings) => ({
  name,
  path,
  writable: name !== "managed",
  exists: true,
  settings,
  source: JSON.stringify(settings, null, 2) + "\n",
});

describe("settings", () => {
  it("moves an entry, de-duplicates the destination, and keeps arrays sorted", () => {
    const source = layer("project-local", "/tmp/source.json", {
      permissions: { allow: ["Bash(z)", "Bash(a)"] },
    });
    const destination = layer("user", "/tmp/destination.json", {
      permissions: { allow: ["Bash(a)"] },
    });
    const planned = applyMoves(
      [source, destination],
      [
        {
          source: { layer: "project-local", field: "allow", value: "Bash(a)" },
          destination: "user",
        },
      ],
    );
    expect(planned[0].settings.permissions.allow).toEqual(["Bash(z)"]);
    expect(planned[1].settings.permissions.allow).toEqual(["Bash(a)"]);
  });

  it("deleting removes only the selected permission field value", () => {
    const source = layer("user", "/tmp/source.json", {
      permissions: { allow: ["Bash(a)"], ask: ["Read(*)"] },
    });
    const planned = applyMoves(
      [source],
      [{ source: { layer: "user", field: "allow", value: "Bash(a)" } }],
    );
    expect(planned[0].settings.permissions).toEqual({
      allow: [],
      ask: ["Read(*)"],
    });
  });

  it("atomic write creates a backup and remains parseable", () => {
    const directory = mkdtempSync(join(tmpdir(), "move-permission-"));
    const path = join(directory, "settings.json");
    mkdirSync(directory, { recursive: true });
    writeFileSync(path, '{\n  "permissions": { "allow": ["old"] }\n}\n');
    const original = loadLayer({
      name: "user",
      path,
      writable: true,
      exists: false,
    });
    const planned = applyMoves(
      [original],
      [{ source: { layer: "user", field: "allow", value: "old" } }],
    );
    writeLayersAtomically(changedLayers([original], planned));
    expect(JSON.parse(readFileSync(path, "utf8")).permissions.allow).toEqual(
      [],
    );
    const backup = readdirSync(directory).find((name) =>
      name.startsWith("settings.json.bak."),
    );
    expect(backup).toBeDefined();
    expect(readFileSync(join(directory, backup), "utf8")).toMatch(/old/);
  });

  it("writes only the changed array when the source already contains it", () => {
    const directory = mkdtempSync(join(tmpdir(), "move-permission-"));
    const path = join(directory, "settings.json");
    const source =
      '{\n    "custom": { "keep": true },\n    "permissions": {\n        "allow": ["old"],\n        "ask": ["keep"]\n    }\n}\n';
    writeFileSync(path, source);
    const original = loadLayer({
      name: "user",
      path,
      writable: true,
      exists: false,
    });
    const planned = applyMoves(
      [original],
      [{ source: { layer: "user", field: "allow", value: "old" } }],
    );
    writeLayersAtomically(changedLayers([original], planned));
    expect(readFileSync(path, "utf8")).toBe(source.replace('["old"]', "[]"));
  });

  it("does not mistake an unrelated allow key for permissions.allow", () => {
    const directory = mkdtempSync(join(tmpdir(), "move-permission-"));
    const path = join(directory, "settings.json");
    const source =
      '{\n  "custom": { "allow": ["untouched"] },\n  "permissions": { "allow": ["old"] }\n}\n';
    writeFileSync(path, source);
    const original = loadLayer({
      name: "user",
      path,
      writable: true,
      exists: false,
    });
    const planned = applyMoves(
      [original],
      [{ source: { layer: "user", field: "allow", value: "old" } }],
    );
    writeLayersAtomically(changedLayers([original], planned));
    expect(readFileSync(path, "utf8")).toBe(
      source.replace(
        '"permissions": { "allow": ["old"] }',
        '"permissions": { "allow": [] }',
      ),
    );
  });

  it("falls back to a complete rendering when a permission field must be created", () => {
    const destination = layer("user", "/tmp/destination.json", {
      permissions: { ask: ["Read(*)"] },
    });
    const source = layer("project-local", "/tmp/source.json", {
      permissions: { allow: ["Bash(a)"] },
    });
    const planned = applyMoves(
      [source, destination],
      [
        {
          source: { layer: "project-local", field: "allow", value: "Bash(a)" },
          destination: "user",
        },
      ],
    );
    expect(renderSettings(planned[1])).toMatch(/"allow": \[\n\s+"Bash\(a\)"/);
  });

  it("a move creates a missing destination only when it receives an entry", () => {
    const source = layer("project-local", "/tmp/source.json", {
      permissions: { allow: ["Bash(a)"] },
    });
    const destination = {
      name: "user",
      path: "/tmp/missing.json",
      writable: true,
      exists: false,
    };
    const planned = applyMoves(
      [source, destination],
      [
        {
          source: { layer: "project-local", field: "allow", value: "Bash(a)" },
          destination: "user",
        },
      ],
    );
    expect(planned[1].settings).toEqual({
      permissions: { allow: ["Bash(a)"] },
    });
    expect(changedLayers([source, destination], planned)).toHaveLength(2);
  });

  it("lists values from all supported permission fields", () => {
    const entries = entriesForLayers([
      layer("user", "/tmp/settings.json", {
        permissions: {
          allow: ["Bash(*)"],
          ask: ["Read(*)"],
          deny: ["WebFetch(*)"],
        },
      }),
    ]);
    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.field)).toEqual([
      "allow",
      "ask",
      "deny",
    ]);
  });
});
