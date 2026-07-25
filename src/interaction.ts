import { type LayerColorizer, layerColorizer, layerLabel } from "./color.js";
import {
  duplicateLayersByEntry,
  entriesForLayers,
  type Layer,
  type Move,
  otherLayersFor,
  type PermissionEntry,
  sourceLayerNames,
  sourceScopesForLayers,
} from "./settings.js";

const noColor = layerColorizer(false);

export interface FormatEntriesOptions {
  allEntries?: PermissionEntry[];
  includeLayer?: boolean;
  colorize?: LayerColorizer;
}

export const formatBrokenLayers = (
  layers: Layer[],
  colorize: LayerColorizer = noColor,
): string[] =>
  layers
    .filter((layer) => layer.error !== undefined)
    .map(
      (layer) =>
        `${layerLabel(colorize, layer.name)} ${layer.path} ${layer.error ?? ""} (skipped)`,
    );

export const formatEntries = (
  entries: PermissionEntry[],
  {
    allEntries = entries,
    includeLayer = true,
    colorize = noColor,
  }: FormatEntriesOptions = {},
): string[] => {
  if (entries.length === 0) return ["No permission entries found."];
  const duplicates = duplicateLayersByEntry(allEntries);
  return entries.map((entry, index) => {
    const others = otherLayersFor(entry, duplicates);
    const duplicateNotice =
      others.length > 0
        ? ` ⚠ also in ${others.map((name) => colorize(name)).join(", ")}`
        : "";
    const prefix = includeLayer ? `${layerLabel(colorize, entry.layer)} ` : "";
    return `${index + 1}. ${prefix}permissions.${entry.field} ${JSON.stringify(entry.value)}${duplicateNotice}`;
  });
};

export const noMovableEntriesLines = (): string[] => [
  `No permission entries in ${sourceLayerNames.join(" or ")} settings to move.`,
  "Run --list to see the entries in every layer.",
];

export const promptForMoves = async (
  layers: Layer[],
  question: (prompt: string) => Promise<string>,
  writeLine: (line: string) => void,
  colorize: LayerColorizer = noColor,
): Promise<Move[] | undefined> => {
  const allEntries = entriesForLayers(layers);
  const sourceScopes = sourceScopesForLayers(layers);
  if (sourceScopes.length === 0) {
    noMovableEntriesLines().forEach(writeLine);
    return undefined;
  }
  writeLine(
    "From scopes: " +
      sourceScopes
        .map(
          (scope, index) =>
            `${index + 1}. ${colorize(scope.layer)} (${scope.entries.length} entries)`,
        )
        .join("  "),
  );
  const sourceIndex = Number(
    await question("Choose source scope (blank to cancel): "),
  );
  const sourceScope = sourceScopes[sourceIndex - 1];
  if (sourceScope === undefined) {
    writeLine("Cancelled.");
    return undefined;
  }
  const { destinations, entries } = sourceScope;
  formatEntries(entries, {
    allEntries,
    includeLayer: false,
    colorize,
  }).forEach(writeLine);
  const selection = await question(
    "Select entry numbers (comma-separated, blank to cancel): ",
  );
  const selected = [
    ...new Set(
      selection
        .split(",")
        .map((item) => Number(item.trim()) - 1)
        .filter(
          (index) =>
            Number.isInteger(index) && index >= 0 && index < entries.length,
        ),
    ),
  ];
  if (selected.length === 0) {
    writeLine("Cancelled.");
    return undefined;
  }
  writeLine(
    "Destinations: " +
      destinations
        .map((name, index) => `${index + 1}. ${colorize(name)}`)
        .join("  ") +
      "  0. delete",
  );
  const actionText = (await question("Choose destination: ")).trim();
  if (actionText === "") {
    writeLine("Cancelled.");
    return undefined;
  }
  const deleting = actionText === "0";
  const action = Number(actionText);
  const destination = deleting ? undefined : destinations[action - 1];
  if (!deleting && (!Number.isInteger(action) || destination === undefined))
    throw new Error("Invalid destination.");
  return selected.map((index) => {
    const source = entries[index];
    if (source === undefined) throw new Error("Selected entry is unavailable.");
    return destination === undefined ? { source } : { source, destination };
  });
};
