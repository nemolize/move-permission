import { describe, expect, it } from "vitest";

import { filterEntries, reduceTui } from "../src/tui.tsx";

const scope = (layer, entries, destinations) => ({
  layer,
  entries,
  destinations,
});

const entry = (layer, field, value) => ({ layer, field, value });

const key = (overrides = {}) => ({
  upArrow: false,
  downArrow: false,
  return: false,
  escape: false,
  backspace: false,
  delete: false,
  ctrl: false,
  meta: false,
  ...overrides,
});

const send = (state, scopes, event) => reduceTui(state, scopes, event);

const source = { kind: "source", scopeIndex: 0 };

const scopes = [
  scope(
    "user",
    [
      entry("user", "allow", "Bash(a)"),
      entry("user", "allow", "Bash(b)"),
      entry("user", "ask", "Read(*)"),
    ],
    ["user-local", "project"],
  ),
  scope(
    "user-local",
    [entry("user-local", "allow", "Bash(local)")],
    ["user", "project"],
  ),
];

describe("filterEntries", () => {
  it("preserves the original index regardless of filter", () => {
    const entries = [
      entry("user", "allow", "Bash(a)"),
      entry("user", "allow", "Bash(b)"),
      entry("user", "ask", "Read(*)"),
    ];
    expect(filterEntries(entries, "read")).toEqual([
      { entry: entries[2], originalIndex: 2 },
    ]);
  });
});

describe("reduceTui — source phase", () => {
  it("moves the cursor with arrow keys and clamps at boundaries", () => {
    const down = send(source, scopes, {
      input: "",
      key: key({ downArrow: true }),
    });
    expect(down).toEqual({
      kind: "state",
      state: { kind: "source", scopeIndex: 1 },
    });
    const stillDown = send(down.state, scopes, {
      input: "",
      key: key({ downArrow: true }),
    });
    expect(stillDown.state.scopeIndex).toBe(1);
    const up = send(down.state, scopes, {
      input: "",
      key: key({ upArrow: true }),
    });
    expect(up.state.scopeIndex).toBe(0);
  });

  it("enters entries phase on Enter with a fresh selection", () => {
    const outcome = send(source, scopes, {
      input: "",
      key: key({ return: true }),
    });
    expect(outcome.kind).toBe("state");
    expect(outcome.state).toMatchObject({
      kind: "entries",
      scopeIndex: 0,
      cursor: 0,
      filter: "",
      filterMode: false,
    });
    expect(outcome.state.selected.size).toBe(0);
  });

  it("cancels on q, Esc, and Ctrl+C", () => {
    for (const event of [
      { input: "q", key: key() },
      { input: "", key: key({ escape: true }) },
      { input: "c", key: key({ ctrl: true }) },
    ]) {
      expect(send(source, scopes, event)).toEqual({
        kind: "done",
        moves: undefined,
      });
    }
  });
});

describe("reduceTui — entries phase", () => {
  const entriesState = {
    kind: "entries",
    scopeIndex: 0,
    cursor: 0,
    selected: new Set(),
    filter: "",
    filterMode: false,
  };

  it("toggles the entry under the cursor with space", () => {
    const toggled = send(entriesState, scopes, { input: " ", key: key() });
    expect([...toggled.state.selected]).toEqual([0]);
    const untoggled = send(toggled.state, scopes, { input: " ", key: key() });
    expect([...untoggled.state.selected]).toEqual([]);
  });

  it("`a` toggles only the currently visible entries and preserves other selections", () => {
    const preselected = {
      ...entriesState,
      selected: new Set([2]),
      filter: "bash",
    };
    const toggledAll = send(preselected, scopes, { input: "a", key: key() });
    expect([...toggledAll.state.selected].sort()).toEqual([0, 1, 2]);
    const toggledOff = send(toggledAll.state, scopes, {
      input: "a",
      key: key(),
    });
    expect([...toggledOff.state.selected]).toEqual([2]);
  });

  it("keeps originalIndex-based selections stable when the filter changes", () => {
    const state = { ...entriesState, selected: new Set([0, 2]) };
    const filtered = send(state, scopes, {
      input: "b",
      key: key(),
    });
    expect(filtered.state).toBe(state);
    const inFilter = send({ ...state, filterMode: true }, scopes, {
      input: "b",
      key: key(),
    });
    expect(inFilter.state.filter).toBe("b");
    expect([...inFilter.state.selected]).toEqual([0, 2]);
    const applied = send(inFilter.state, scopes, {
      input: "",
      key: key({ return: true }),
    });
    expect(applied.state.filterMode).toBe(false);
    expect([...applied.state.selected]).toEqual([0, 2]);
  });

  it("enters filter mode on / and edits the filter via typing / backspace", () => {
    const opened = send(entriesState, scopes, { input: "/", key: key() });
    expect(opened.state.filterMode).toBe(true);
    const typed = send(opened.state, scopes, { input: "r", key: key() });
    expect(typed.state.filter).toBe("r");
    const back = send(typed.state, scopes, {
      input: "",
      key: key({ backspace: true }),
    });
    expect(back.state.filter).toBe("");
  });

  it("Esc inside filter mode clears the filter without cancelling", () => {
    const filtered = { ...entriesState, filter: "abc", filterMode: true };
    const cleared = send(filtered, scopes, {
      input: "",
      key: key({ escape: true }),
    });
    expect(cleared).toEqual({
      kind: "state",
      state: { ...filtered, filter: "", filterMode: false, cursor: 0 },
    });
  });

  it("Enter with a non-empty selection advances to destination phase", () => {
    const staged = { ...entriesState, selected: new Set([2, 0]) };
    const outcome = send(staged, scopes, {
      input: "",
      key: key({ return: true }),
    });
    expect(outcome.state).toEqual({
      kind: "destination",
      scopeIndex: 0,
      selectedEntryIndexes: [0, 2],
      cursor: 0,
    });
  });

  it("Enter with an empty selection is a no-op", () => {
    const outcome = send(entriesState, scopes, {
      input: "",
      key: key({ return: true }),
    });
    expect(outcome.state).toBe(entriesState);
  });

  it("cancels on q / Esc / Ctrl+C outside filter mode", () => {
    for (const event of [
      { input: "q", key: key() },
      { input: "", key: key({ escape: true }) },
      { input: "c", key: key({ ctrl: true }) },
    ]) {
      expect(send(entriesState, scopes, event)).toEqual({
        kind: "done",
        moves: undefined,
      });
    }
  });
});

describe("reduceTui — destination phase", () => {
  const destState = {
    kind: "destination",
    scopeIndex: 0,
    selectedEntryIndexes: [0, 2],
    cursor: 0,
  };

  it("cursor bounds are [0, destinations.length] inclusive (delete row at the end)", () => {
    let state = destState;
    for (let step = 0; step < 5; step += 1) {
      state = send(state, scopes, {
        input: "",
        key: key({ downArrow: true }),
      }).state;
    }
    expect(state.cursor).toBe(scopes[0].destinations.length);
    for (let step = 0; step < 5; step += 1) {
      state = send(state, scopes, {
        input: "",
        key: key({ upArrow: true }),
      }).state;
    }
    expect(state.cursor).toBe(0);
  });

  it("Enter on a destination produces moves with that destination", () => {
    const outcome = send(destState, scopes, {
      input: "",
      key: key({ return: true }),
    });
    expect(outcome.kind).toBe("done");
    expect(outcome.moves).toEqual([
      {
        source: scopes[0].entries[0],
        destination: scopes[0].destinations[0],
      },
      {
        source: scopes[0].entries[2],
        destination: scopes[0].destinations[0],
      },
    ]);
  });

  it("Enter on the delete row produces destination-less moves", () => {
    const outcome = send(
      { ...destState, cursor: scopes[0].destinations.length },
      scopes,
      { input: "", key: key({ return: true }) },
    );
    expect(outcome.moves).toEqual([
      { source: scopes[0].entries[0] },
      { source: scopes[0].entries[2] },
    ]);
  });

  it("cancels on q / Esc / Ctrl+C", () => {
    for (const event of [
      { input: "q", key: key() },
      { input: "", key: key({ escape: true }) },
      { input: "c", key: key({ ctrl: true }) },
    ]) {
      expect(send(destState, scopes, event)).toEqual({
        kind: "done",
        moves: undefined,
      });
    }
  });
});
