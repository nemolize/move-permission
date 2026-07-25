import { execFileSync } from "node:child_process";
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export const permissionFields = ["allow", "ask", "deny"] as const;
export type PermissionField = (typeof permissionFields)[number];
export type LayerName =
  "user" | "user-local" | "project" | "project-local" | "managed";
export type Settings = Record<string, unknown> & {
  permissions?: Record<string, unknown>;
};

export interface Layer {
  name: LayerName;
  path: string;
  writable: boolean;
  exists: boolean;
  settings?: Settings;
  source?: string;
  error?: string;
}

export interface PermissionEntry {
  layer: LayerName;
  field: PermissionField;
  value: string;
}

export interface Move {
  source: PermissionEntry;
  destination?: LayerName;
}

export interface SourceScope {
  layer: LayerName;
  entries: PermissionEntry[];
  destinations: LayerName[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseSettings = (source: string): Settings => {
  const parsed: unknown = JSON.parse(source);
  if (!isRecord(parsed)) throw new Error("Settings must be a JSON object");
  return parsed;
};

const userPath = (home: string, name: string) => join(home, ".claude", name);

export const managedSettingsPath = (platform = process.platform): string =>
  platform === "darwin"
    ? "/Library/Application Support/ClaudeCode/managed-settings.json"
    : "/etc/claude-code/managed-settings.json";

const gitRoot = (cwd: string): string | undefined => {
  try {
    return execFileSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
};

export const discoverLayers = (
  cwd: string,
  home = process.env["HOME"] ?? "",
): Layer[] => {
  const root = gitRoot(cwd);
  const layers: Layer[] = [
    {
      name: "user",
      path: userPath(home, "settings.json"),
      writable: true,
      exists: false,
    },
    {
      name: "user-local",
      path: userPath(home, "settings.local.json"),
      writable: true,
      exists: false,
    },
  ];
  if (root !== undefined) {
    layers.push(
      {
        name: "project",
        path: join(root, ".claude", "settings.json"),
        writable: true,
        exists: false,
      },
      {
        name: "project-local",
        path: join(root, ".claude", "settings.local.json"),
        writable: true,
        exists: false,
      },
    );
  }
  layers.push({
    name: "managed",
    path: managedSettingsPath(),
    writable: false,
    exists: false,
  });
  return layers.map((layer) => {
    try {
      return loadLayer(layer);
    } catch (error) {
      return {
        ...layer,
        exists: true,
        writable: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
};

export const loadLayer = (layer: Layer): Layer => {
  if (!existsSync(layer.path)) return { ...layer, exists: false };
  const source = readFileSync(layer.path, "utf8");
  let settings: Settings;
  try {
    settings = parseSettings(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`contains invalid JSON: ${message}`, { cause: error });
  }
  return { ...layer, exists: true, source, settings };
};

export const nonStringPermissionValues = (
  layers: Layer[],
): { layer: LayerName; field: PermissionField; count: number }[] =>
  layers.flatMap((layer) => {
    const permissions = layer.settings?.permissions;
    if (!permissions || typeof permissions !== "object") return [];
    return permissionFields.flatMap((field) => {
      const values = permissions[field];
      if (!Array.isArray(values)) return [];
      const count = values.filter((value) => typeof value !== "string").length;
      return count > 0 ? [{ layer: layer.name, field, count }] : [];
    });
  });

const duplicateKey = (entry: PermissionEntry): string =>
  `${entry.field}\u0000${entry.value}`;

export const duplicateLayersByEntry = (
  entries: PermissionEntry[],
): Map<string, LayerName[]> => {
  const map = new Map<string, LayerName[]>();
  for (const entry of entries) {
    const key = duplicateKey(entry);
    map.set(key, [...(map.get(key) ?? []), entry.layer]);
  }
  return map;
};

export const otherLayersFor = (
  entry: PermissionEntry,
  duplicates: Map<string, LayerName[]>,
): LayerName[] => [
  ...new Set(
    (duplicates.get(duplicateKey(entry)) ?? []).filter(
      (name) => name !== entry.layer,
    ),
  ),
];

export const entriesForLayers = (layers: Layer[]): PermissionEntry[] =>
  layers
    .flatMap((layer) => {
      const permissions = layer.settings?.permissions;
      if (!permissions || typeof permissions !== "object") return [];
      return permissionFields.flatMap((field) => {
        const values = permissions[field];
        if (!Array.isArray(values)) return [];
        return values
          .filter((value): value is string => typeof value === "string")
          .map((value) => ({ layer: layer.name, field, value }));
      });
    })
    .sort(
      (a, b) =>
        a.field.localeCompare(b.field) ||
        a.value.localeCompare(b.value) ||
        a.layer.localeCompare(b.layer),
    );

export const sourceLayerNames: readonly LayerName[] = [
  "project",
  "project-local",
];

const isSourceLayer = (name: LayerName): boolean =>
  sourceLayerNames.includes(name);

export const sourceScopesForLayers = (layers: Layer[]): SourceScope[] => {
  const writableLayerNames = layers
    .filter((layer) => layer.writable)
    .map((layer) => layer.name);
  return layers.flatMap((layer) => {
    const entries = entriesForLayers([layer]);
    if (!layer.writable || !isSourceLayer(layer.name) || entries.length === 0)
      return [];
    return [
      {
        layer: layer.name,
        entries,
        destinations: writableLayerNames.filter((name) => name !== layer.name),
      },
    ];
  });
};

const clone = <T>(value: T): T => structuredClone(value);

const valuesFor = (settings: Settings, field: PermissionField): string[] => {
  const permissions = settings.permissions;
  if (
    !permissions ||
    typeof permissions !== "object" ||
    !Array.isArray(permissions[field])
  )
    return [];
  return permissions[field].filter(
    (value): value is string => typeof value === "string",
  );
};

const setValues = (
  settings: Settings,
  field: PermissionField,
  values: string[],
): void => {
  if (!settings.permissions || typeof settings.permissions !== "object")
    settings.permissions = {};
  settings.permissions[field] = [...new Set(values)].sort();
};

export const applyMoves = (layers: Layer[], moves: Move[]): Layer[] => {
  const planned = layers.map((layer) =>
    layer.settings
      ? { ...layer, settings: clone(layer.settings) }
      : { ...layer },
  );
  const byName = new Map(planned.map((layer) => [layer.name, layer]));
  for (const move of moves) {
    const source = byName.get(move.source.layer);
    if (!source?.settings || source.writable !== true)
      throw new Error(
        `Cannot modify unavailable or read-only source layer: ${move.source.layer}`,
      );
    setValues(
      source.settings,
      move.source.field,
      valuesFor(source.settings, move.source.field).filter(
        (value) => value !== move.source.value,
      ),
    );
    if (!move.destination) continue;
    const destination = byName.get(move.destination);
    if (destination?.writable !== true)
      throw new Error(
        `Cannot move to unavailable or read-only layer: ${move.destination}`,
      );
    if (!destination.settings) destination.settings = {};
    setValues(destination.settings, move.source.field, [
      ...valuesFor(destination.settings, move.source.field),
      move.source.value,
    ]);
  }
  return planned;
};

const indentOf = (source: string | undefined): number => {
  const match = source?.match(/^\s+(?=")/m);
  return match ? match[0].length : 2;
};

const valueEnd = (source: string, start: number): number => {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source.charAt(index);
    if (quoted) {
      if (!escaped && character === '"') quoted = false;
      escaped = !escaped && character === "\\";
      continue;
    }
    if (character === '"') {
      quoted = true;
      continue;
    }
    if (character === "[" || character === "{") depth += 1;
    if (character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error("Could not find the end of a JSON value");
};

const renderArrayPreservingLayout = (
  arraySource: string,
  previous: string[],
  next: string[],
): string => {
  if (!arraySource.includes("\n")) return JSON.stringify(next);
  const inner = arraySource.slice(1, -1);
  const closingIndentMatch = /\n([ \t]*)$/.exec(inner);
  if (!closingIndentMatch) return JSON.stringify(next);
  const closingIndent = closingIndentMatch[1] ?? "";
  const elementPattern = /([ \t]*)("(?:\\.|[^"\\])*")/g;
  const elementLines = new Map<string, string>();
  let elementIndent: string | undefined;
  for (;;) {
    const match = elementPattern.exec(inner);
    if (!match) break;
    const [, indent = "", quoted = ""] = match;
    if (elementIndent === undefined) elementIndent = indent;
    let value: unknown;
    try {
      value = JSON.parse(quoted);
    } catch {
      return JSON.stringify(next);
    }
    if (typeof value !== "string") return JSON.stringify(next);
    elementLines.set(value, `${indent}${quoted}`);
  }
  if (previous.some((value) => !elementLines.has(value)))
    return JSON.stringify(next);
  const fallbackIndent = elementIndent ?? `${closingIndent}  `;
  const lines = next.map(
    (value) =>
      elementLines.get(value) ?? `${fallbackIndent}${JSON.stringify(value)}`,
  );
  if (lines.length === 0) return `[\n${closingIndent}]`;
  return `[\n${lines.join(",\n")}\n${closingIndent}]`;
};

const replaceExistingPermissionArrays = (layer: Layer): string | undefined => {
  if (layer.source === undefined || layer.settings === undefined)
    return undefined;
  const original = parseSettings(layer.source);
  const originalPermissions = original.permissions;
  const nextPermissions = layer.settings.permissions;
  if (
    !originalPermissions ||
    !nextPermissions ||
    typeof originalPermissions !== "object" ||
    typeof nextPermissions !== "object"
  )
    return undefined;
  let rendered = layer.source;
  for (const field of permissionFields) {
    const previous = originalPermissions[field];
    const next = nextPermissions[field];
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    if (!Array.isArray(previous) || !Array.isArray(next)) return undefined;
    const permissionsMatch = /"permissions"\s*:\s*/.exec(rendered);
    if (!permissionsMatch || permissionsMatch.index === undefined)
      return undefined;
    const permissionsStart =
      permissionsMatch.index + permissionsMatch[0].length;
    if (rendered[permissionsStart] !== "{") return undefined;
    const permissionsEnd = valueEnd(rendered, permissionsStart);
    const permissionsSource = rendered.slice(permissionsStart, permissionsEnd);
    const fieldPattern = new RegExp(`"${field}"\\s*:\\s*`);
    const match = fieldPattern.exec(permissionsSource);
    if (!match || match.index === undefined) return undefined;
    const start = permissionsStart + match.index + match[0].length;
    if (rendered[start] !== "[") return undefined;
    const end = valueEnd(rendered, start);
    const previousStrings = previous.filter(
      (value): value is string => typeof value === "string",
    );
    const nextStrings = next.filter(
      (value): value is string => typeof value === "string",
    );
    const arraySource = rendered.slice(start, end);
    const replacement =
      previousStrings.length === previous.length &&
      nextStrings.length === next.length
        ? renderArrayPreservingLayout(arraySource, previousStrings, nextStrings)
        : JSON.stringify(nextStrings);
    rendered = rendered.slice(0, start) + replacement + rendered.slice(end);
  }
  return rendered;
};

export const renderSettings = (layer: Layer): string =>
  replaceExistingPermissionArrays(layer) ??
  `${JSON.stringify(layer.settings, null, indentOf(layer.source))}\n`;

export const changedLayers = (before: Layer[], after: Layer[]): Layer[] =>
  after.filter((layer) => {
    const original = before.find((candidate) => candidate.name === layer.name);
    return Boolean(
      layer.writable &&
      layer.settings &&
      JSON.stringify(layer.settings) !==
        JSON.stringify(original?.settings ?? {}),
    );
  });

export const writeLayersAtomically = (layers: Layer[]): void => {
  const epoch = Date.now();
  for (const layer of layers) {
    if (layer.settings === undefined || !layer.writable) continue;
    const rendered = renderSettings(layer);
    JSON.parse(rendered);
    mkdirSync(dirname(layer.path), { recursive: true });
    if (existsSync(layer.path))
      copyFileSync(layer.path, `${layer.path}.bak.${epoch}`);
    const temporary = `${layer.path}.tmp`;
    writeFileSync(temporary, rendered, "utf8");
    const handle = openSync(temporary, "r");
    fsyncSync(handle);
    closeSync(handle);
    renameSync(temporary, layer.path);
  }
};
