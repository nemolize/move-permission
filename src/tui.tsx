import { Box, render, Text, useApp, useInput, useWindowSize } from "ink";
import { useState } from "react";

import { type LayerColorizer } from "./color.js";
import {
  duplicateLayersByEntry,
  entriesForLayers,
  type Layer,
  type LayerName,
  type Move,
  otherLayersFor,
  type PermissionEntry,
  type SourceScope,
  sourceScopesForLayers,
} from "./settings.js";

interface KeyEvent {
  upArrow?: boolean;
  downArrow?: boolean;
  return?: boolean;
  escape?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
}

export type TuiEvent = { input: string; key: KeyEvent };

export type TuiState =
  | { kind: "source"; scopeIndex: number }
  | {
      kind: "entries";
      scopeIndex: number;
      cursor: number;
      selected: ReadonlySet<number>;
      filter: string;
      filterMode: boolean;
    }
  | {
      kind: "destination";
      scopeIndex: number;
      selectedEntryIndexes: readonly number[];
      cursor: number;
    };

export type ReducerOutcome =
  | { kind: "state"; state: TuiState }
  | { kind: "done"; moves: Move[] | undefined };

const initialState: TuiState = { kind: "source", scopeIndex: 0 };

export const computeVisibleWindow = (
  cursor: number,
  total: number,
  viewportSize: number,
): { start: number; end: number } => {
  if (total <= 0 || viewportSize <= 0) return { start: 0, end: 0 };
  const size = Math.min(viewportSize, total);
  const half = Math.floor(size / 2);
  const rawStart = cursor - half;
  const maxStart = total - size;
  const start = Math.max(0, Math.min(rawStart, maxStart));
  return { start, end: start + size };
};

export const filterEntries = (
  entries: readonly PermissionEntry[],
  filter: string,
): { entry: PermissionEntry; originalIndex: number }[] => {
  const query = filter.toLowerCase();
  return entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .filter(({ entry }) =>
      query === ""
        ? true
        : `${entry.field} ${entry.value}`.toLowerCase().includes(query),
    );
};

const isCancel = ({ input, key }: TuiEvent): boolean =>
  key.escape === true || input === "q" || (key.ctrl === true && input === "c");

const clampCursor = (cursor: number, count: number): number =>
  Math.max(0, Math.min(count - 1, cursor));

const stateOutcome = (state: TuiState): ReducerOutcome => ({
  kind: "state",
  state,
});

const doneOutcome = (moves: Move[] | undefined): ReducerOutcome => ({
  kind: "done",
  moves,
});

const buildMoves = (
  scope: SourceScope,
  selectedIndexes: readonly number[],
  destinationCursor: number,
): Move[] => {
  const deleting = destinationCursor === scope.destinations.length;
  const destination = deleting
    ? undefined
    : scope.destinations[destinationCursor];
  if (!deleting && destination === undefined) return [];
  return selectedIndexes
    .map((index): Move | undefined => {
      const entry = scope.entries[index];
      if (entry === undefined) return undefined;
      return destination === undefined
        ? { source: entry }
        : { source: entry, destination };
    })
    .filter((move): move is Move => move !== undefined);
};

const reduceSource = (
  state: Extract<TuiState, { kind: "source" }>,
  scopes: readonly SourceScope[],
  event: TuiEvent,
): ReducerOutcome => {
  if (isCancel(event)) return doneOutcome(undefined);
  const { key } = event;
  if (key.upArrow === true)
    return stateOutcome({
      ...state,
      scopeIndex: clampCursor(state.scopeIndex - 1, scopes.length),
    });
  if (key.downArrow === true)
    return stateOutcome({
      ...state,
      scopeIndex: clampCursor(state.scopeIndex + 1, scopes.length),
    });
  if (key.return === true) {
    const scope = scopes[state.scopeIndex];
    if (scope === undefined) return stateOutcome(state);
    return stateOutcome({
      kind: "entries",
      scopeIndex: state.scopeIndex,
      cursor: 0,
      selected: new Set<number>(),
      filter: "",
      filterMode: false,
    });
  }
  return stateOutcome(state);
};

const reduceFilterInput = (
  state: Extract<TuiState, { kind: "entries" }>,
  event: TuiEvent,
): ReducerOutcome => {
  const { input, key } = event;
  if (key.return === true)
    return stateOutcome({ ...state, filterMode: false, cursor: 0 });
  if (key.escape === true)
    return stateOutcome({
      ...state,
      filter: "",
      filterMode: false,
      cursor: 0,
    });
  if (key.backspace === true || key.delete === true)
    return stateOutcome({ ...state, filter: state.filter.slice(0, -1) });
  if (input !== "" && key.ctrl !== true && key.meta !== true)
    return stateOutcome({ ...state, filter: state.filter + input });
  return stateOutcome(state);
};

const reduceEntries = (
  state: Extract<TuiState, { kind: "entries" }>,
  scopes: readonly SourceScope[],
  event: TuiEvent,
): ReducerOutcome => {
  const scope = scopes[state.scopeIndex];
  if (scope === undefined) return doneOutcome(undefined);
  if (state.filterMode) return reduceFilterInput(state, event);
  const { input, key } = event;
  if (isCancel(event)) return doneOutcome(undefined);
  if (input === "/") return stateOutcome({ ...state, filterMode: true });
  const visible = filterEntries(scope.entries, state.filter);
  if (key.upArrow === true)
    return stateOutcome({
      ...state,
      cursor: clampCursor(state.cursor - 1, visible.length),
    });
  if (key.downArrow === true)
    return stateOutcome({
      ...state,
      cursor: clampCursor(state.cursor + 1, visible.length),
    });
  if (input === " ") {
    const target = visible[state.cursor];
    if (target === undefined) return stateOutcome(state);
    const next = new Set(state.selected);
    if (next.has(target.originalIndex)) next.delete(target.originalIndex);
    else next.add(target.originalIndex);
    return stateOutcome({ ...state, selected: next });
  }
  if (input === "a") {
    const allVisibleSelected =
      visible.length > 0 &&
      visible.every(({ originalIndex }) => state.selected.has(originalIndex));
    const next = new Set(state.selected);
    if (allVisibleSelected) {
      for (const { originalIndex } of visible) next.delete(originalIndex);
    } else {
      for (const { originalIndex } of visible) next.add(originalIndex);
    }
    return stateOutcome({ ...state, selected: next });
  }
  if (key.return === true) {
    if (state.selected.size === 0) return stateOutcome(state);
    return stateOutcome({
      kind: "destination",
      scopeIndex: state.scopeIndex,
      selectedEntryIndexes: [...state.selected].sort((a, b) => a - b),
      cursor: 0,
    });
  }
  return stateOutcome(state);
};

const reduceDestination = (
  state: Extract<TuiState, { kind: "destination" }>,
  scopes: readonly SourceScope[],
  event: TuiEvent,
): ReducerOutcome => {
  const scope = scopes[state.scopeIndex];
  if (scope === undefined) return doneOutcome(undefined);
  if (isCancel(event)) return doneOutcome(undefined);
  const optionCount = scope.destinations.length + 1;
  const { key } = event;
  if (key.upArrow === true)
    return stateOutcome({
      ...state,
      cursor: clampCursor(state.cursor - 1, optionCount),
    });
  if (key.downArrow === true)
    return stateOutcome({
      ...state,
      cursor: clampCursor(state.cursor + 1, optionCount),
    });
  if (key.return === true)
    return doneOutcome(
      buildMoves(scope, state.selectedEntryIndexes, state.cursor),
    );
  return stateOutcome(state);
};

export const reduceTui = (
  state: TuiState,
  scopes: readonly SourceScope[],
  event: TuiEvent,
): ReducerOutcome => {
  if (state.kind === "source") return reduceSource(state, scopes, event);
  if (state.kind === "entries") return reduceEntries(state, scopes, event);
  return reduceDestination(state, scopes, event);
};

const SourceView = ({
  scopes,
  cursor,
  colorize,
}: {
  scopes: readonly SourceScope[];
  cursor: number;
  colorize: LayerColorizer;
}): React.ReactElement => (
  <Box flexDirection="column">
    <Text bold>Choose source scope (↑/↓, Enter to confirm, Esc/q to quit)</Text>
    {scopes.map((scope, index) => (
      <Text key={scope.layer}>
        {index === cursor ? "▶ " : "  "}
        <Text>{colorize(scope.layer)}</Text> ({scope.entries.length} entries)
      </Text>
    ))}
  </Box>
);

export const EntriesView = ({
  entries,
  allEntries,
  cursor,
  selected,
  filter,
  filterMode,
  colorize,
  viewportRows,
}: {
  entries: readonly PermissionEntry[];
  allEntries: readonly PermissionEntry[];
  cursor: number;
  selected: ReadonlySet<number>;
  filter: string;
  filterMode: boolean;
  colorize: LayerColorizer;
  viewportRows: number;
}): React.ReactElement => {
  const visible = filterEntries(entries, filter);
  const duplicates = duplicateLayersByEntry([...allEntries]);
  const window = computeVisibleWindow(cursor, visible.length, viewportRows);
  const windowed = visible.slice(window.start, window.end);
  const hiddenAbove = window.start;
  const hiddenBelow = Math.max(0, visible.length - window.end);
  return (
    <Box flexDirection="column">
      <Text bold>
        Select entries (space toggle, a toggle all, / filter, Enter confirm,
        Esc/q cancel)
      </Text>
      {filterMode ? (
        <Text>Filter: {filter}▏ (Enter to apply, Esc to clear)</Text>
      ) : filter !== "" ? (
        <Text dimColor>Filter: {filter} (press / to edit)</Text>
      ) : null}
      {visible.length === 0 ? (
        <Text dimColor>No entries match the current filter.</Text>
      ) : (
        <>
          {hiddenAbove > 0 ? (
            <Text dimColor>↑ {hiddenAbove} more above</Text>
          ) : null}
          {windowed.map(({ entry, originalIndex }, windowIndex) => {
            const others = otherLayersFor(entry, duplicates);
            const visibleIndex = window.start + windowIndex;
            const marker = visibleIndex === cursor ? "▶" : " ";
            const check = selected.has(originalIndex) ? "◼" : "◻";
            return (
              <Text key={`${originalIndex}`}>
                {marker} {check} permissions.{entry.field}{" "}
                {JSON.stringify(entry.value)}
                {others.length > 0 ? (
                  <Text dimColor>
                    {" ⚠ also in "}
                    {others.map((name, index) => (
                      <Text key={name}>
                        {index > 0 ? ", " : ""}
                        <Text>{colorize(name)}</Text>
                      </Text>
                    ))}
                  </Text>
                ) : null}
              </Text>
            );
          })}
          {hiddenBelow > 0 ? (
            <Text dimColor>↓ {hiddenBelow} more below</Text>
          ) : null}
        </>
      )}
      <Text dimColor>
        {selected.size} selected · {visible.length} total
      </Text>
    </Box>
  );
};

type DestinationOption =
  { kind: "layer"; name: LayerName } | { kind: "delete" };

const destinationOptions = (
  destinations: readonly LayerName[],
): DestinationOption[] => [
  ...destinations.map((name) => ({ kind: "layer" as const, name })),
  { kind: "delete" as const },
];

const DestinationView = ({
  destinations,
  cursor,
  colorize,
}: {
  destinations: readonly LayerName[];
  cursor: number;
  colorize: LayerColorizer;
}): React.ReactElement => (
  <Box flexDirection="column">
    <Text bold>Choose destination (↑/↓, Enter to confirm, Esc/q to quit)</Text>
    {destinationOptions(destinations).map((option, index) => (
      <Text key={option.kind === "layer" ? option.name : "__delete__"}>
        {index === cursor ? "▶ " : "  "}
        {option.kind === "layer" ? (
          <Text>{colorize(option.name)}</Text>
        ) : (
          <Text>delete</Text>
        )}
      </Text>
    ))}
  </Box>
);

interface TuiProps {
  layers: Layer[];
  colorize: LayerColorizer;
  scopes: readonly SourceScope[];
  onFinish: (moves: Move[] | undefined) => void;
}

const ENTRIES_VIEWPORT_OVERHEAD = 6;

const Tui = ({
  layers,
  colorize,
  scopes,
  onFinish,
}: TuiProps): React.ReactElement => {
  const allEntries = entriesForLayers(layers);
  const { exit } = useApp();
  const [state, setState] = useState<TuiState>(initialState);
  const { rows } = useWindowSize();
  const viewportRows = Math.max(1, rows - ENTRIES_VIEWPORT_OVERHEAD);

  useInput((input, key) => {
    const outcome = reduceTui(state, scopes, { input, key });
    if (outcome.kind === "done") {
      onFinish(outcome.moves);
      exit();
      return;
    }
    setState(outcome.state);
  });

  if (state.kind === "source")
    return (
      <SourceView
        scopes={scopes}
        cursor={state.scopeIndex}
        colorize={colorize}
      />
    );
  const scope = scopes[state.scopeIndex];
  if (scope === undefined) return <Text>Invalid scope.</Text>;
  if (state.kind === "entries")
    return (
      <EntriesView
        entries={scope.entries}
        allEntries={allEntries}
        cursor={state.cursor}
        selected={state.selected}
        filter={state.filter}
        filterMode={state.filterMode}
        colorize={colorize}
        viewportRows={viewportRows}
      />
    );
  return (
    <DestinationView
      destinations={scope.destinations}
      cursor={state.cursor}
      colorize={colorize}
    />
  );
};

export const runTui = async (
  layers: Layer[],
  colorize: LayerColorizer,
): Promise<Move[] | undefined> => {
  const scopes = sourceScopesForLayers(layers);
  if (scopes.length === 0) return undefined;
  let outcome: Move[] | undefined;
  const instance = render(
    <Tui
      layers={layers}
      colorize={colorize}
      scopes={scopes}
      onFinish={(moves) => {
        outcome = moves;
      }}
    />,
  );
  try {
    await instance.waitUntilExit();
  } finally {
    instance.clear();
  }
  return outcome;
};
