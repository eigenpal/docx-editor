// Whether two value graphs are the same graph: the comparison a rebuilt read has to pass.
//
// Deeper than `toEqual`, which ignores key order, prototypes, frozen state and sharing. Each of
// those is observable to the engine — an iteration order, an `Object.isFrozen` guard, a
// reference compare — so a stand-in for the reader's output must match it on all of them.

/** The first place two graphs differ, as a path and a reason, or `null` when they are one. */
export function sameGraph(left: unknown, right: unknown): string | null {
  const pairs = new Map<object, object>();
  const reverse = new Map<object, object>();

  const walk = (a: unknown, b: unknown, path: string): string | null => {
    if (typeof a !== typeof b) return `${path}: ${typeof a} vs ${typeof b}`;
    if (typeof a !== 'object' || a === null || b === null) {
      return Object.is(a, b) ? null : `${path}: ${String(a)} vs ${String(b)}`;
    }
    const x = a as object;
    const y = b as object;
    const paired = pairs.get(x);
    if (paired !== undefined || reverse.has(y)) {
      return paired === y ? null : `${path}: shared differently`;
    }
    pairs.set(x, y);
    reverse.set(y, x);
    if (Object.getPrototypeOf(x) !== Object.getPrototypeOf(y)) return `${path}: prototype`;
    if (Object.isFrozen(x) !== Object.isFrozen(y)) return `${path}: frozen ${Object.isFrozen(x)}`;
    if (x instanceof Uint8Array) {
      const z = y as Uint8Array;
      if (x.length !== z.length) return `${path}: byte length`;
      for (let index = 0; index < x.length; index += 1) {
        if (x[index] !== z[index]) return `${path}[${index}]: byte`;
      }
      return null;
    }
    if (x instanceof Map) {
      const left = [...x];
      const right = [...(y as Map<unknown, unknown>)];
      if (left.length !== right.length) return `${path}: map size`;
      for (let index = 0; index < left.length; index += 1) {
        const [key, value] = left[index]!;
        const [otherKey, otherValue] = right[index]!;
        const keyDifference = walk(key, otherKey, `${path}{${index}}.key`);
        if (keyDifference) return keyDifference;
        const valueDifference = walk(value, otherValue, `${path}{${String(key)}}`);
        if (valueDifference) return valueDifference;
      }
      return null;
    }
    const keys = Reflect.ownKeys(x);
    const otherKeys = Reflect.ownKeys(y);
    if (keys.join('\u0000') !== otherKeys.join('\u0000')) {
      return `${path}: keys ${keys.join(',')} vs ${otherKeys.join(',')}`;
    }
    for (const key of keys) {
      const difference = walk(
        (x as Record<PropertyKey, unknown>)[key],
        (y as Record<PropertyKey, unknown>)[key],
        `${path}.${String(key)}`
      );
      if (difference) return difference;
    }
    return null;
  };

  return walk(left, right, '$');
}
