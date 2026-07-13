#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { applyMoves, changedLayers, discoverLayers, entriesForLayers, renderSettings, type LayerName, type Move, writeLayersAtomically } from "./settings.js";

const args = new Set(process.argv.slice(2));
const usage = () => console.log("Usage: move-permission [--list] [--dry-run]");
const printEntries = (): ReturnType<typeof discoverLayers> => {
  const layers = discoverLayers(process.cwd());
  const entries = entriesForLayers(layers);
  if (!entries.length) console.log("No permission entries found.");
  for (const [index, entry] of entries.entries()) console.log(`${index + 1}. [${entry.layer}] permissions.${entry.field} ${JSON.stringify(entry.value)}`);
  return layers;
};
const layerNames = (layers: ReturnType<typeof discoverLayers>): LayerName[] => layers.filter((layer) => layer.writable).map((layer) => layer.name);
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
  if ([...args].some((arg) => !["--list", "--dry-run"].includes(arg))) { usage(); process.exitCode = 2; return; }
  const layers = printEntries();
  if (args.has("--list")) return;
  const entries = entriesForLayers(layers);
  if (!entries.length) return;
  const readline = createInterface({ input, output });
  const selection = await readline.question("Select entry numbers (comma-separated, blank to cancel): ");
  const selected = [...new Set(selection.split(",").map((item) => Number(item.trim()) - 1).filter((index) => Number.isInteger(index) && index >= 0 && index < entries.length))];
  if (!selected.length) { readline.close(); console.log("Cancelled."); return; }
  const destinations = layerNames(layers);
  console.log("Destinations: " + destinations.map((name, index) => `${index + 1}. ${name}`).join("  ") + "  0. delete");
  const action = Number(await readline.question("Choose destination: "));
  readline.close();
  const destination = action === 0 ? undefined : destinations[action - 1];
  if (action !== 0 && !destination) throw new Error("Invalid destination.");
  const moves: Move[] = selected.map((index) => ({ source: entries[index]!, destination }));
  const planned = applyMoves(layers, moves);
  const changed = changedLayers(layers, planned);
  printPreview(changed);
  if (args.has("--dry-run")) { console.log("Dry run: no files were written."); return; }
  const confirmationReader = createInterface({ input, output });
  const confirmation = await confirmationReader.question("Apply these changes? [y/N] ");
  confirmationReader.close();
  if (confirmation.toLowerCase() !== "y") { console.log("Cancelled."); return; }
  writeLayersAtomically(changed);
  console.log("Changes applied.");
};

main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
