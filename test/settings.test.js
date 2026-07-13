import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { applyMoves, changedLayers, entriesForLayers, loadLayer, renderSettings, writeLayersAtomically } from "../dist/settings.js";

const layer = (name, path, settings) => ({ name, path, writable: name !== "managed", exists: true, settings, source: JSON.stringify(settings, null, 2) + "\n" });

test("moves an entry, de-duplicates the destination, and keeps arrays sorted", () => {
  const source = layer("project-local", "/tmp/source.json", { permissions: { allow: ["Bash(z)", "Bash(a)"] } });
  const destination = layer("user", "/tmp/destination.json", { permissions: { allow: ["Bash(a)"] } });
  const planned = applyMoves([source, destination], [{ source: { layer: "project-local", field: "allow", value: "Bash(a)" }, destination: "user" }]);
  assert.deepEqual(planned[0].settings.permissions.allow, ["Bash(z)"]);
  assert.deepEqual(planned[1].settings.permissions.allow, ["Bash(a)"]);
});

test("deleting removes only the selected permission field value", () => {
  const source = layer("user", "/tmp/source.json", { permissions: { allow: ["Bash(a)"], ask: ["Read(*)"] } });
  const planned = applyMoves([source], [{ source: { layer: "user", field: "allow", value: "Bash(a)" } }]);
  assert.deepEqual(planned[0].settings.permissions, { allow: [], ask: ["Read(*)"] });
});

test("atomic write creates a backup and remains parseable", () => {
  const directory = mkdtempSync(join(tmpdir(), "move-permission-"));
  const path = join(directory, "settings.json");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, '{\n  "permissions": { "allow": ["old"] }\n}\n');
  const original = loadLayer({ name: "user", path, writable: true, exists: false });
  const planned = applyMoves([original], [{ source: { layer: "user", field: "allow", value: "old" } }]);
  writeLayersAtomically(changedLayers([original], planned));
  assert.deepEqual(JSON.parse(readFileSync(path, "utf8")).permissions.allow, []);
  const backup = readdirSync(directory).find((name) => name.startsWith("settings.json.bak."));
  assert.ok(backup);
  assert.match(readFileSync(join(directory, backup), "utf8"), /old/);
});

test("writes only the changed array when the source already contains it", () => {
  const directory = mkdtempSync(join(tmpdir(), "move-permission-"));
  const path = join(directory, "settings.json");
  const source = '{\n    "custom": { "keep": true },\n    "permissions": {\n        "allow": ["old"],\n        "ask": ["keep"]\n    }\n}\n';
  writeFileSync(path, source);
  const original = loadLayer({ name: "user", path, writable: true, exists: false });
  const planned = applyMoves([original], [{ source: { layer: "user", field: "allow", value: "old" } }]);
  writeLayersAtomically(changedLayers([original], planned));
  assert.equal(readFileSync(path, "utf8"), source.replace('["old"]', '[]'));
});

test("does not mistake an unrelated allow key for permissions.allow", () => {
  const directory = mkdtempSync(join(tmpdir(), "move-permission-"));
  const path = join(directory, "settings.json");
  const source = '{\n  "custom": { "allow": ["untouched"] },\n  "permissions": { "allow": ["old"] }\n}\n';
  writeFileSync(path, source);
  const original = loadLayer({ name: "user", path, writable: true, exists: false });
  const planned = applyMoves([original], [{ source: { layer: "user", field: "allow", value: "old" } }]);
  writeLayersAtomically(changedLayers([original], planned));
  assert.equal(readFileSync(path, "utf8"), source.replace('"permissions": { "allow": ["old"] }', '"permissions": { "allow": [] }'));
});

test("falls back to a complete rendering when a permission field must be created", () => {
  const destination = layer("user", "/tmp/destination.json", { permissions: { ask: ["Read(*)"] } });
  const source = layer("project-local", "/tmp/source.json", { permissions: { allow: ["Bash(a)"] } });
  const planned = applyMoves([source, destination], [{ source: { layer: "project-local", field: "allow", value: "Bash(a)" }, destination: "user" }]);
  assert.match(renderSettings(planned[1]), /"allow": \[\n\s+"Bash\(a\)"/);
});

test("a move creates a missing destination only when it receives an entry", () => {
  const source = layer("project-local", "/tmp/source.json", { permissions: { allow: ["Bash(a)"] } });
  const destination = { name: "user", path: "/tmp/missing.json", writable: true, exists: false };
  const planned = applyMoves([source, destination], [{ source: { layer: "project-local", field: "allow", value: "Bash(a)" }, destination: "user" }]);
  assert.deepEqual(planned[1].settings, { permissions: { allow: ["Bash(a)"] } });
  assert.equal(changedLayers([source, destination], planned).length, 2);
});

test("lists values from all supported permission fields", () => {
  const entries = entriesForLayers([layer("user", "/tmp/settings.json", { permissions: { allow: ["Bash(*)"], ask: ["Read(*)"], deny: ["WebFetch(*)"] } })]);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((entry) => entry.field), ["allow", "ask", "deny"]);
});
