import { CommanderError } from "commander";
import { describe, expect, it } from "vitest";

import {
  createProgram,
  exitCodeForCommanderError,
  normalizeUserArguments,
} from "../src/program.ts";

describe("createProgram", () => {
  it("documents every supported option", () => {
    const help = createProgram().helpInformation();

    expect(help).toContain("-h, --help");
    expect(help).toContain("--list");
    expect(help).toContain("--dry-run");
  });

  it("accepts help after the pnpm argument separator", () => {
    const program = createProgram()
      .configureOutput({ writeOut: () => undefined, writeErr: () => undefined })
      .exitOverride();

    try {
      program.parse(normalizeUserArguments(["--", "--help"]), {
        from: "user",
      });
      throw new Error("Expected Commander to stop after displaying help.");
    } catch (error) {
      expect(error).toBeInstanceOf(CommanderError);
      expect(exitCodeForCommanderError(error)).toBe(0);
    }
  });

  it("maps an unknown option to a usage exit code", () => {
    const program = createProgram()
      .configureOutput({ writeOut: () => undefined, writeErr: () => undefined })
      .exitOverride();

    try {
      program.parse(["--unknown"], { from: "user" });
      throw new Error("Expected Commander to reject the unknown option.");
    } catch (error) {
      expect(error).toBeInstanceOf(CommanderError);
      expect(exitCodeForCommanderError(error)).toBe(2);
    }
  });
});
