export type SheetSession<T> = {
  phase: "closed" | "open" | "closing";
  content: T | null;
  id: number;
};

/** A closing native presentation owns its last content until onDismiss fires. */
export function syncSheetSession<T>(
  state: SheetSession<T>,
  visible: boolean,
  content: T,
): SheetSession<T> {
  if (state.phase === "closing") return state;
  if (!visible)
    return state.phase === "open" ? { ...state, phase: "closing" } : state;
  if (state.phase === "closed")
    return { phase: "open", content, id: state.id + 1 };
  return state.content === content ? state : { ...state, content };
}

export function finishSheetSession<T>(
  state: SheetSession<T>,
  id: number,
): SheetSession<T> {
  return state.id === id ? { phase: "closed", content: null, id } : state;
}

export type SheetDetent =
  "medium" | "large" | { fraction: number } | { height: number };

/** Percentages remain native fractions, so iOS resolves its own safe areas. */
export function resolveSheetDetents(
  points: (string | number)[] | undefined,
  maxHeight: number,
): SheetDetent[] {
  const result: SheetDetent[] = [];
  const seen = new Set<string>();
  for (const point of points ?? []) {
    let detent: SheetDetent;
    if (typeof point === "number") {
      if (!Number.isFinite(point) || point <= 0) continue;
      detent = { height: Math.min(Math.max(44, point), maxHeight) };
    } else if (point === "half") detent = "medium";
    else if (point === "full") detent = "large";
    else {
      const match = /^\s*(\d+(?:\.\d+)?)%\s*$/.exec(point);
      if (!match || Number(match[1]) <= 0) continue;
      const fraction = Math.min(1, Number(match[1]) / 100);
      detent = fraction === 1 ? "large" : { fraction };
    }
    const key = JSON.stringify(detent);
    if (!seen.has(key)) {
      result.push(detent);
      seen.add(key);
    }
  }
  return result;
}
