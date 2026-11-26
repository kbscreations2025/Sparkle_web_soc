/**
 * Small pure edits on a card, addressed by path. A path names keys, and after
 * a list's key, an entry's `id`: ["items", "a1b2", "caption"] is the caption
 * of gallery item a1b2. Ids rather than indexes, so an edit lands on the
 * right row even if the rows were reordered since the path was built.
 */
export type Path = readonly string[];

export function getIn(target: unknown, path: Path): unknown {
  let current = target;
  for (const segment of path) {
    if (Array.isArray(current)) current = current.find((entry) => entry?.id === segment);
    else if (current && typeof current === "object") current = (current as Record<string, unknown>)[segment];
    else return undefined;
  }
  return current;
}

export function setIn<T>(target: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [head, ...rest] = path;
  if (Array.isArray(target)) {
    return target.map((entry) => (entry?.id === head ? setIn(entry, rest, value) : entry)) as T;
  }
  const object = (target && typeof target === "object" ? target : {}) as Record<string, unknown>;
  return { ...object, [head]: setIn(object[head], rest, value) } as T;
}

/** Moves the entry at `from` to `to`, returning a new array. */
export function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  if (from < 0 || from >= next.length || to < 0 || to >= next.length) return next;
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry);
  return next;
}
