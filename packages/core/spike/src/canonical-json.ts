/** @spike-features fixture-comparators */
/**
 * Canonical JSON uses ascending ECMAScript UTF-16 code-unit lexical key order:
 * compare strings with `<`/`>`, never localeCompare. Arrays preserve order.
 * Only dense JSON-safe trees of null, booleans, finite numbers, strings,
 * arrays, and ordinary Object.prototype objects are accepted.
 */
export function canonicalJson(value: unknown): string {
  return serializeJson(value, new WeakSet<object>());
}

function serializeJson(value: unknown, ancestors: WeakSet<object>): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('canonical JSON requires finite numbers');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') {
    throw new TypeError(`canonical JSON rejects ${typeof value}`);
  }
  if (ancestors.has(value)) throw new TypeError('canonical JSON rejects cycles');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const ownKeys = Reflect.ownKeys(value).filter((key) => key !== 'length');
      if (
        ownKeys.some(
          (key) =>
            typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length
        ) ||
        ownKeys.length !== value.length
      ) {
        throw new TypeError('canonical JSON requires dense arrays without extra keys');
      }
      return `[${value.map((child) => serializeJson(child, ancestors)).join(',')}]`;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      throw new TypeError('canonical JSON requires Object.prototype objects');
    }
    const keys = Reflect.ownKeys(value);
    if (keys.some((key) => typeof key !== 'string')) {
      throw new TypeError('canonical JSON rejects symbol keys');
    }
    const stringKeys = keys as string[];
    if (stringKeys.some((key) => ['__proto__', 'constructor', 'prototype'].includes(key))) {
      throw new TypeError('canonical JSON rejects unsafe keys');
    }
    for (const key of stringKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
      if (!descriptor.enumerable || !('value' in descriptor)) {
        throw new TypeError('canonical JSON requires enumerable data properties');
      }
    }
    return `{${stringKeys
      .sort(codeUnitCompare)
      .map(
        (key) =>
          `${JSON.stringify(key)}:${serializeJson(
            (value as Record<string, unknown>)[key],
            ancestors
          )}`
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function codeUnitCompare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
