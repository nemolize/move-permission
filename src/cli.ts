#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { CommanderError } from "commander";

import {
  createProgram,
  exitCodeForCommanderError,
  normalizeUserArguments,
} from "./program.js";
import {
  applyMoves,
  changedLayers,
  discoverLayers,
  entriesForLayers,
  type LayerName,
  type Move,
  renderSettings,
  sourceScopesForLayers,
  writeLayersAtomically,
} from "./settings.js";

const printEntries = (
  entries: ReturnType<typeof entriesForLayers>,
  allEntries = entries,
  includeLayer = true,
): void => {
  const duplicateLayers = new Map<string, LayerName[]>();
  for (const entry of allEntries) {
    const key = `${entry.field}\u0000${entry.value}`;
    duplicateLayers.set(key, [
      ...(duplicateLayers.get(key) ?? []),
      entry.layer,
    ]);
  }
  if (!entries.length) console.log("No permission entries found.");
  for (const [index, entry] of entries.entries()) {
    const key = `${entry.field}\u0000${entry.value}`;
    const otherLayers = [
      ...new Set(
        (duplicateLayers.get(key) ?? []).filter(
          (layer) => layer !== entry.layer,
        ),
      ),
    ];
    const duplicateNotice =
      otherLayers.length > 0 ? ` ⚠ also in ${otherLayers.join(", ")}` : "";
    console.log(
      `${index + 1}. ${includeLayer ? `[${entry.layer}] ` : ""}permissions.${entry.field} ${JSON.stringify(entry.value)}${duplicateNotice}`,
    );
  }
};

const printPreview = (layers: ReturnType<typeof discoverLayers>): void => {
  console.log("\nPlanned changes:");
  for (const layer of layers) {
    const previous = layer.source ?? "";
    const next = renderSettings(layer);
    console.log(`--- ${layer.path}`);
    console.log(`+++ ${layer.path}`);
    for (const line of previous.split("\n")) if (line) console.log(`- ${line}`);
    for (const line of next.split("\n")) if (line) console.log(`+ ${line}`);
  }
};

const main = async (): Promise<void> => {
  const program = createProgram();
  program.exitOverride();
  try {
    program.parse(normalizeUserArguments(process.argv.slice(2)), {
      from: "user",
    });
  } catch (error: unknown) {
    if (error instanceof CommanderError) {
      process.exitCode = exitCodeForCommanderError(error);
      return;
    }
    throw error;
  }
  const options = program.opts<{ dryRun?: boolean; list?: boolean }>();
  const layers = discoverLayers(process.cwd());
  const allEntries = entriesForLayers(layers);
  if (options.list === true) {
    printEntries(allEntries);
    return;
  }
  const sourceScopes = sourceScopesForLayers(layers);
  if (!sourceScopes.length) {
    printEntries(allEntries);
    return;
  }
  const readline = createInterface({ input, output });
  console.log(
    "From scopes: " +
      sourceScopes
        .map(
          (scope, index) =>
            `${index + 1}. ${scope.layer.name} (${scope.entries.length} entries)`,
        )
        .join("  "),
  );
  const sourceIndex = Number(
    await readline.question("Choose source scope (blank to cancel): "),
  );
  const sourceScope = sourceScopes[sourceIndex - 1];
  if (sourceScope === undefined) {
    readline.close();
    console.log("Cancelled.");
    return;
  }
  const { destinations, entries } = sourceScope;
  printEntries(entries, allEntries, false);
  const selection = await readline.question(
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
  if (!selected.length) {
    readline.close();
    console.log("Cancelled.");
    return;
  }
  console.log(
    "Destinations: " +
      destinations.map((name, index) => `${index + 1}. ${name}`).join("  ") +
      "  0. delete",
  );
  const action = Number(await readline.question("Choose destination: "));
  readline.close();
  const destination = action === 0 ? undefined : destinations[action - 1];
  if (action !== 0 && !destination) throw new Error("Invalid destination.");
  const moves: Move[] = selected.map((index) => {
    const source = entries[index];
    if (source === undefined) throw new Error("Selected entry is unavailable.");
    return destination === undefined ? { source } : { source, destination };
  });
  const planned = applyMoves(layers, moves);
  const changed = changedLayers(layers, planned);
  printPreview(changed);
  if (options.dryRun === true) {
    console.log("Dry run: no files were written.");
    return;
  }
  const confirmationReader = createInterface({ input, output });
  const confirmation = await confirmationReader.question(
    "Apply these changes? [y/N] ",
  );
  confirmationReader.close();
  if (confirmation.toLowerCase() !== "y") {
    console.log("Cancelled.");
    return;
  }
  writeLayersAtomically(changed);
  console.log("Changes applied.");
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
