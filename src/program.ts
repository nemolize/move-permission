import { Command, type CommanderError } from "commander";

export const normalizeUserArguments = (
  arguments_: readonly string[],
): string[] => arguments_.filter((argument) => argument !== "--");

export const exitCodeForCommanderError = (error: CommanderError): number =>
  error.exitCode === 0 ? 0 : 2;

export const createProgram = (): Command =>
  new Command()
    .name("move-permission")
    .description("Move Claude Code permission entries between settings layers")
    .option("--list", "List permission entries without changing settings")
    .option("--dry-run", "Preview a selected move without writing files")
    .showHelpAfterError();
