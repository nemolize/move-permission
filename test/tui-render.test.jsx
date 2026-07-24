import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";

import { layerColorizer } from "../src/color.js";
import { EntriesView } from "../src/tui.tsx";

const colorize = layerColorizer(false);

const makeEntries = (n) =>
  Array.from({ length: n }, (_, i) => ({
    layer: "user",
    field: "allow",
    value: `Bash(cmd-${i})`,
  }));

const renderFrame = (cursor, total, viewportRows, selected = new Set()) => {
  const entries = makeEntries(total);
  const { lastFrame, unmount } = render(
    <EntriesView
      entries={entries}
      allEntries={entries}
      cursor={cursor}
      selected={selected}
      filter=""
      filterMode={false}
      colorize={colorize}
      viewportRows={viewportRows}
    />,
  );
  const frame = lastFrame() ?? "";
  unmount();
  return frame;
};

const cursorLine = (frame) =>
  frame.split("\n").find((line) => line.startsWith("▶")) ?? "";

describe("EntriesView viewport rendering", () => {
  it("keeps the cursor visible and anchors to the top when it sits on the first entry", () => {
    const frame = renderFrame(0, 1000, 20);
    expect(cursorLine(frame)).toContain("Bash(cmd-0)");
    expect(frame).not.toContain("more above");
    expect(frame).toContain("↓ 980 more below");
    expect(frame).toContain("0 selected · 1000 total");
  });

  it("centres the window on the cursor once it has moved into the middle", () => {
    const frame = renderFrame(500, 1000, 20);
    expect(cursorLine(frame)).toContain("Bash(cmd-500)");
    expect(frame).toContain("↑ 490 more above");
    expect(frame).toContain("↓ 490 more below");
  });

  it("anchors to the bottom when the cursor nears the last entry", () => {
    const frame = renderFrame(999, 1000, 20);
    expect(cursorLine(frame)).toContain("Bash(cmd-999)");
    expect(frame).toContain("↑ 980 more above");
    expect(frame).not.toContain("more below");
  });

  it("renders every entry without indicators when the list fits the viewport", () => {
    const frame = renderFrame(2, 5, 20);
    expect(frame).not.toContain("more above");
    expect(frame).not.toContain("more below");
    for (let i = 0; i < 5; i++) {
      expect(frame).toContain(`Bash(cmd-${i})`);
    }
    expect(frame).toContain("0 selected · 5 total");
  });

  it("marks selected entries and reflects the count in the footer", () => {
    const frame = renderFrame(0, 1000, 20, new Set([0, 5, 10]));
    expect(frame).toContain('▶ ◼ permissions.allow "Bash(cmd-0)"');
    expect(frame).toContain("3 selected · 1000 total");
  });
});
