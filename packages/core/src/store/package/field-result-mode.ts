// How saved field results are addressed in paragraph offsets.
//
// `atomic` (the default): every closed field is one offset unit, whatever its result. This is
// the raw paragraph text that `paragraphTextOf`, collaboration, and the automation lane read.
//
// `editable`: a field that shows its SAVED result (DATE, MERGEFIELD, HYPERLINK display text,
// see `fieldResultAddressing`) addresses its result runs as ordinary text, and its markers and
// instruction take no offsets. Fields painted from a live value stay one unit.
//
// The mode is passed explicitly at every public boundary (`EditOptions.fieldResults`,
// `paragraphTextOf(..., { fieldResults })`). Inside one synchronous store call the boundary
// installs it with `withFieldResultsMode`, so the deep offset helpers it reaches read the same
// mode without each signature carrying it. Nothing outside such a call ever sees `editable`.

/** How saved field results are addressed. */
export type FieldResultsMode = 'atomic' | 'editable';

let current: FieldResultsMode = 'atomic';

/** The mode of the store call in progress; `atomic` outside any scoped call. */
export function currentFieldResultsMode(): FieldResultsMode {
  return current;
}

/**
 * Run `run` with `mode` installed for every offset helper it reaches, then restore the outer
 * mode, also when `run` throws. `undefined` keeps the outer mode.
 */
export function withFieldResultsMode<T>(mode: FieldResultsMode | undefined, run: () => T): T {
  if (mode === undefined || mode === current) return run();
  const outer = current;
  current = mode;
  try {
    return run();
  } finally {
    current = outer;
  }
}

/**
 * A node-keyed memo that keeps one entry per mode: offsets computed in one mode never answer
 * a read in the other.
 */
export class FieldResultsModeMemo<K extends object, V> {
  readonly #atomic = new WeakMap<K, V>();
  readonly #editable = new WeakMap<K, V>();

  #map(): WeakMap<K, V> {
    return current === 'editable' ? this.#editable : this.#atomic;
  }

  has(key: K): boolean {
    return this.#map().has(key);
  }

  get(key: K): V | undefined {
    return this.#map().get(key);
  }

  set(key: K, value: V): void {
    this.#map().set(key, value);
  }
}
