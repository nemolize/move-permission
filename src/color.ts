import type { LayerName } from "./settings.js";

export type LayerColorizer = (name: LayerName, text?: string) => string;

const ESC = "\x1b[";
const RESET = `${ESC}0m`;

const cyan = `${ESC}36m`;
const brightCyan = `${ESC}96m`;
const green = `${ESC}32m`;
const brightGreen = `${ESC}92m`;
const yellow = `${ESC}33m`;

// Sibling layers (user ↔ user-local, project ↔ project-local) share a hue —
// base for the shared scope, bright for the local override.
const layerAnsi: Record<LayerName, string> = {
  user: cyan,
  "user-local": brightCyan,
  project: green,
  "project-local": brightGreen,
  managed: yellow,
};

export const layerColorizer =
  (enabled: boolean): LayerColorizer =>
  (name, text = name) =>
    enabled ? `${layerAnsi[name]}${text}${RESET}` : text;

const disabledValues = new Set(["0", "false"]);

const isDisabling = (value: string | undefined): boolean =>
  value !== undefined && disabledValues.has(value.toLowerCase());

export const shouldColorize = (
  env: NodeJS.ProcessEnv,
  isTty: boolean,
): boolean => {
  if (env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "") return false;
  const force = env["FORCE_COLOR"];
  if (force !== undefined && force !== "") return !isDisabling(force);
  return isTty;
};

export const layerLabel = (colorize: LayerColorizer, name: LayerName): string =>
  colorize(name, `[${name}]`);
