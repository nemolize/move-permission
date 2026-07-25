#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";

import { CommanderError } from "commander";

import { layerColorizer, layerLabel, shouldColorize } from "./color.js";
import {
  formatBrokenLayers,
  formatEntries,
  noMovableEntriesLines,
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
  sourceScopesForLayers,
  writeLayersAtomically,
} from "./settings.js";
import { runTui } from "./tui.js";

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
  const colorize = layerColorizer(
    shouldColorize(process.env, process.stdout.isTTY === true),
  );
  const warnColorize = layerColorizer(
    shouldColorize(process.env, process.stderr.isTTY === true),
  );
  formatBrokenLayers(layers, warnColorize).forEach((line) =>
    console.warn(line),
  );
  for (const item of nonStringPermissionValues(layers)) {
    console.warn(
      `${layerLabel(warnColorize, item.layer)} permissions.${item.field} has ${item.count} non-string value(s) that will be dropped on write.`,
    );
  }
  if (options.list === true) {
    formatEntries(entriesForLayers(layers), { colorize }).forEach((line) =>
      console.log(line),
    );
    return;
  }
  if (sourceScopesForLayers(layers).length === 0) {
    noMovableEntriesLines().forEach((line) => console.log(line));
    return;
  }
  const interactive =
    process.stdin.isTTY === true && process.stdout.isTTY === true;
  let moves: Move[] | undefined;
  if (interactive) {
    moves = await runTui(layers, colorize);
  } else {
    const readline = createInterface({ input, output });
    try {
      moves = await promptForMoves(
        layers,
        (prompt) => readline.question(prompt),
        (line) => console.log(line),
        colorize,
      );
    } finally {
      readline.close();
    }
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
