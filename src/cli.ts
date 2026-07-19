#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { CommanderError } from "commander";

import {
  formatBrokenLayers,
  formatEntries,
  promptForMoves,
} from "./interaction.js";
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
  type Move,
  nonStringPermissionValues,
  renderSettings,
  writeLayersAtomically,
} from "./settings.js";

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
  formatBrokenLayers(layers).forEach((line) => console.warn(line));
  for (const item of nonStringPermissionValues(layers)) {
    console.warn(
      `[${item.layer}] permissions.${item.field} has ${item.count} non-string value(s) that will be dropped on write.`,
    );
  }
  if (options.list === true) {
    formatEntries(entriesForLayers(layers)).forEach((line) =>
      console.log(line),
    );
    return;
  }
  const readline = createInterface({ input, output });
  let moves: Move[] | undefined;
  try {
    moves = await promptForMoves(
      layers,
      (prompt) => readline.question(prompt),
      (line) => console.log(line),
    );
  } finally {
    readline.close();
  }
  if (moves === undefined) return;
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
