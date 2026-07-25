import { execFileSync } from "node:child_process";
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
  discoverLayers,
  entriesForLayers,
  loadLayer,
  managedSettingsPath,
  nonStringPermissionValues,
  renderSettings,
  sourceLayerNames,
  sourceScopesForLayers,
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

  it("preserves multi-line array formatting when removing an element", () => {
    const directory = mkdtempSync(join(tmpdir(), "move-permission-"));
    const path = join(directory, "settings.json");
    const source =
      '{\n  "permissions": {\n    "allow": [\n      "Bash(a)",\n      "Bash(b)",\n      "Bash(c)"\n    ]\n  }\n}\n';
    writeFileSync(path, source);
    const original = loadLayer({
      name: "user",
      path,
      writable: true,
      exists: false,
    });
    const planned = applyMoves(
      [original],
      [{ source: { layer: "user", field: "allow", value: "Bash(b)" } }],
    );
    writeLayersAtomically(changedLayers([original], planned));
    expect(readFileSync(path, "utf8")).toBe(
      '{\n  "permissions": {\n    "allow": [\n      "Bash(a)",\n      "Bash(c)"\n    ]\n  }\n}\n',
    );
  });

  it("preserves multi-line array formatting when inserting an element", () => {
    const directory = mkdtempSync(join(tmpdir(), "move-permission-"));
    const sourcePath = join(directory, "src.json");
    const destPath = join(directory, "dst.json");
    writeFileSync(
      sourcePath,
      '{\n  "permissions": {\n    "allow": [\n      "Bash(new)"\n    ]\n  }\n}\n',
    );
    writeFileSync(
      destPath,
      '{\n  "permissions": {\n    "allow": [\n      "Bash(a)",\n      "Bash(z)"\n    ]\n  }\n}\n',
    );
    const src = loadLayer({
      name: "project-local",
      path: sourcePath,
      writable: true,
      exists: false,
    });
    const dst = loadLayer({
      name: "user",
      path: destPath,
      writable: true,
      exists: false,
    });
    const planned = applyMoves(
      [src, dst],
      [
        {
          source: {
            layer: "project-local",
            field: "allow",
            value: "Bash(new)",
          },
          destination: "user",
        },
      ],
    );
    writeLayersAtomically(changedLayers([src, dst], planned));
    expect(readFileSync(destPath, "utf8")).toBe(
      '{\n  "permissions": {\n    "allow": [\n      "Bash(a)",\n      "Bash(new)",\n      "Bash(z)"\n    ]\n  }\n}\n',
    );
  });

  it("preserves original escaping of unchanged elements", () => {
    const directory = mkdtempSync(join(tmpdir(), "move-permission-"));
    const path = join(directory, "settings.json");
    const source =
      '{\n  "permissions": {\n    "allow": [\n      "Bash(\\u0041)",\n      "Bash(drop)"\n    ]\n  }\n}\n';
    writeFileSync(path, source);
    const original = loadLayer({
      name: "user",
      path,
      writable: true,
      exists: false,
    });
    const planned = applyMoves(
      [original],
      [{ source: { layer: "user", field: "allow", value: "Bash(drop)" } }],
    );
    writeLayersAtomically(changedLayers([original], planned));
    expect(readFileSync(path, "utf8")).toBe(
      '{\n  "permissions": {\n    "allow": [\n      "Bash(\\u0041)"\n    ]\n  }\n}\n',
    );
  });

  it("preserves multi-line layout when removing the last element", () => {
    const directory = mkdtempSync(join(tmpdir(), "move-permission-"));
    const path = join(directory, "settings.json");
    const source =
      '{\n  "permissions": {\n    "allow": [\n      "Bash(only)"\n    ]\n  }\n}\n';
    writeFileSync(path, source);
    const original = loadLayer({
      name: "user",
      path,
      writable: true,
      exists: false,
    });
    const planned = applyMoves(
      [original],
      [{ source: { layer: "user", field: "allow", value: "Bash(only)" } }],
    );
    writeLayersAtomically(changedLayers([original], planned));
    expect(readFileSync(path, "utf8")).toBe(
      '{\n  "permissions": {\n    "allow": [\n    ]\n  }\n}\n',
    );
  });

  it("handles escaped quotes and backslashes in element values", () => {
    const directory = mkdtempSync(join(tmpdir(), "move-permission-"));
    const path = join(directory, "settings.json");
    const source =
      '{\n  "permissions": {\n    "allow": [\n      "Bash(echo \\"x\\")",\n      "Bash(cd C:\\\\tmp)",\n      "Bash(drop)"\n    ]\n  }\n}\n';
    writeFileSync(path, source);
    const original = loadLayer({
      name: "user",
      path,
      writable: true,
      exists: false,
    });
    const planned = applyMoves(
      [original],
      [{ source: { layer: "user", field: "allow", value: "Bash(drop)" } }],
    );
    writeLayersAtomically(changedLayers([original], planned));
    expect(readFileSync(path, "utf8")).toBe(
      '{\n  "permissions": {\n    "allow": [\n      "Bash(cd C:\\\\tmp)",\n      "Bash(echo \\"x\\")"\n    ]\n  }\n}\n',
    );
  });

  it("collapses only the touched array when it holds non-string values", () => {
    const directory = mkdtempSync(join(tmpdir(), "move-permission-"));
    const path = join(directory, "settings.json");
    const source =
      '{\n  "permissions": {\n    "allow": [\n      "Bash(keep)",\n      42\n    ],\n    "ask": [\n      "Read(*)"\n    ]\n  }\n}\n';
    writeFileSync(path, source);
    const original = loadLayer({
      name: "user",
      path,
      writable: true,
      exists: false,
    });
    const planned = applyMoves(
      [original],
      [{ source: { layer: "user", field: "allow", value: "Bash(keep)" } }],
    );
    writeLayersAtomically(changedLayers([original], planned));
    expect(readFileSync(path, "utf8")).toBe(
      '{\n  "permissions": {\n    "allow": [],\n    "ask": [\n      "Read(*)"\n    ]\n  }\n}\n',
    );
  });

  it("reports non-string permission values that would be dropped", () => {
    const layers = [
      {
        name: "user",
        path: "/tmp/settings.json",
        writable: true,
        exists: true,
        settings: {
          permissions: { allow: ["Bash(a)", 42, null], ask: ["Read(*)"] },
        },
      },
    ];
    expect(nonStringPermissionValues(layers)).toEqual([
      { layer: "user", field: "allow", count: 2 },
    ]);
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

  it("derives scoped entries and non-self writable destinations", () => {
    const user = layer("user", "/tmp/settings.json", {
      permissions: { allow: ["Bash(*)"] },
    });
    const project = layer("project", "/tmp/project-settings.json", {
      permissions: { ask: ["Read(*)"] },
    });
    const managed = layer("managed", "/tmp/managed-settings.json", {
      permissions: { deny: ["WebFetch(*)"] },
    });

    const scopes = sourceScopesForLayers([user, project, managed]);

    expect(scopes.map((scope) => scope.layer)).toEqual(["project"]);
    expect(scopes[0]).toMatchObject({
      entries: [{ layer: "project", field: "ask", value: "Read(*)" }],
      destinations: ["user"],
    });
  });

  it("offers only project layers as sources, keeping user layers as destinations", () => {
    const user = layer("user", "/tmp/settings.json", {
      permissions: { allow: ["Bash(user)"] },
    });
    const userLocal = layer("user-local", "/tmp/settings.local.json", {
      permissions: { allow: ["Bash(user-local)"] },
    });
    const project = layer("project", "/tmp/project-settings.json", {
      permissions: { allow: ["Bash(project)"] },
    });
    const projectLocal = layer(
      "project-local",
      "/tmp/project-settings.local.json",
      { permissions: { allow: ["Bash(project-local)"] } },
    );

    const scopes = sourceScopesForLayers([
      user,
      userLocal,
      project,
      projectLocal,
    ]);

    expect(scopes.map((scope) => scope.layer)).toEqual([...sourceLayerNames]);
    expect(scopes[0]?.destinations).toEqual([
      "user",
      "user-local",
      "project-local",
    ]);
  });

  it("yields no source scopes when only user layers hold entries", () => {
    const user = layer("user", "/tmp/settings.json", {
      permissions: { allow: ["Bash(*)"] },
    });
    const userLocal = layer("user-local", "/tmp/settings.local.json", {
      permissions: { deny: ["WebFetch(*)"] },
    });

    expect(sourceScopesForLayers([user, userLocal])).toEqual([]);
  });

  it("rejects moves from a read-only source layer", () => {
    const managed = layer("managed", "/tmp/managed-settings.json", {
      permissions: { allow: ["Read(*)"] },
    });

    expect(() =>
      applyMoves(
        [managed],
        [{ source: { layer: "managed", field: "allow", value: "Read(*)" } }],
      ),
    ).toThrow("Cannot modify unavailable or read-only source layer: managed");
  });

  it("reports invalid JSON as a broken layer instead of throwing", () => {
    const home = mkdtempSync(join(tmpdir(), "move-permission-home-"));
    mkdirSync(join(home, ".claude"), { recursive: true });
    writeFileSync(join(home, ".claude", "settings.json"), "{ not json");
    writeFileSync(
      join(home, ".claude", "settings.local.json"),
      '{"permissions":{"allow":["Bash(ok)"]}}',
    );
    const project = mkdtempSync(join(tmpdir(), "move-permission-project-"));
    execFileSync("git", ["init", "--quiet", project]);
    mkdirSync(join(project, ".claude"), { recursive: true });
    writeFileSync(
      join(project, ".claude", "settings.json"),
      '{"permissions":{"allow":["Bash(project-ok)"]}}',
    );
    const layers = discoverLayers(project, home);
    const user = layers.find((layer) => layer.name === "user");
    const userLocal = layers.find((layer) => layer.name === "user-local");
    expect(user?.error).toMatch(/invalid JSON/);
    expect(user?.writable).toBe(false);
    expect(userLocal?.settings).toEqual({
      permissions: { allow: ["Bash(ok)"] },
    });
    // The broken user layer must not stop the remaining layers being usable.
    expect(sourceScopesForLayers(layers).map((scope) => scope.layer)).toEqual([
      "project",
    ]);
  });

  it("uses the platform-specific managed settings path", () => {
    expect(managedSettingsPath("darwin")).toBe(
      "/Library/Application Support/ClaudeCode/managed-settings.json",
    );
    expect(managedSettingsPath("linux")).toBe(
      "/etc/claude-code/managed-settings.json",
    );
  });
});
