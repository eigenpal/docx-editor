/** @public */
export interface RefObject<T> {
  readonly current: T | null;
}

/** Bridges a Vue ref to the shared RefObject surface. */
export function refAsRefObject<T>(source: { readonly value: T | null }): RefObject<T> {
  return {
    get current() {
      return source.value;
    },
  };
}
