import { describe, expect, it } from "vitest";

import { layerColorizer, layerLabel, shouldColorize } from "../src/color.ts";

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[(\d+)m/;

describe("shouldColorize", () => {
  it("returns false when NO_COLOR is set to a non-empty value", () => {
    expect(shouldColorize({ NO_COLOR: "1" }, true)).toBe(false);
  });

  it("returns true when FORCE_COLOR is set (even without a TTY)", () => {
    expect(shouldColorize({ FORCE_COLOR: "1" }, false)).toBe(true);
  });

  it("treats FORCE_COLOR=0 as an explicit off signal", () => {
    expect(shouldColorize({ FORCE_COLOR: "0" }, true)).toBe(false);
  });

  it("treats FORCE_COLOR=false (any case) as an explicit off signal", () => {
    expect(shouldColorize({ FORCE_COLOR: "false" }, true)).toBe(false);
    expect(shouldColorize({ FORCE_COLOR: "FALSE" }, true)).toBe(false);
  });

  it("follows the TTY signal when no override is set", () => {
    expect(shouldColorize({}, true)).toBe(true);
    expect(shouldColorize({}, false)).toBe(false);
  });

  it("prefers NO_COLOR over FORCE_COLOR when both are set", () => {
    expect(shouldColorize({ NO_COLOR: "1", FORCE_COLOR: "1" }, true)).toBe(
      false,
    );
  });
});

describe("layerColorizer", () => {
  it("wraps text in a distinct ANSI code per layer when enabled", () => {
    const colorize = layerColorizer(true);
    const userCode = ANSI.exec(colorize("user", "x"))?.[1];
    const projectCode = ANSI.exec(colorize("project", "x"))?.[1];
    expect(userCode).toBeDefined();
    expect(projectCode).toBeDefined();
    expect(userCode).not.toEqual(projectCode);
  });

  it("defaults the wrapped text to the layer name itself", () => {
    const colorize = layerColorizer(true);
    /* eslint-disable no-control-regex */
    expect(colorize("user")).toMatch(/^\x1b\[\d+muser\x1b\[0m$/);
    /* eslint-enable no-control-regex */
  });

  it("passes text through unchanged when disabled", () => {
    const colorize = layerColorizer(false);
    expect(colorize("user", "[user]")).toBe("[user]");
    expect(colorize("managed", "[managed]")).toBe("[managed]");
    expect(colorize("user")).toBe("user");
  });
});

describe("layerLabel", () => {
  it("wraps the bracketed layer name in colour when enabled", () => {
    const colorize = layerColorizer(true);
    /* eslint-disable no-control-regex */
    expect(layerLabel(colorize, "user")).toMatch(
      /^\x1b\[\d+m\[user\]\x1b\[0m$/,
    );
    /* eslint-enable no-control-regex */
  });

  it("returns the bracketed layer name unchanged when colour is off", () => {
    const colorize = layerColorizer(false);
    expect(layerLabel(colorize, "project-local")).toBe("[project-local]");
  });
});
