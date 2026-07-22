/** @spike-features insert-delete-split-join-operations, origin-metadata, awareness-metadata, one-annotation-anchor */
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Reflect.ownKeys(Object.getOwnPropertyDescriptors(value));
  if (actual.some((key) => typeof key !== 'string' || isUnsafeKey(key))) return false;
  const strings = actual as string[];
  const wanted = [...expected].sort();
  return strings.length === wanted.length && strings.sort().every((key, index) => key === wanted[index]);
}

export function isUnsafeKey(key: string): boolean {
  return key === '__proto__' || key === 'constructor' || key === 'prototype';
}

export function readClosedDataObject(
  value: unknown,
  expectedKeys: readonly string[],
  label: string
): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new TypeError(`${label} must be a plain object`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== 'string' || isUnsafeKey(key))) {
    throw new TypeError(`invalid ${label} fields`);
  }
  if (!hasExactKeys(value, expectedKeys)) throw new TypeError(`invalid ${label} fields`);
  const result: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} accessor fields are forbidden`);
    }
    result[key] = descriptor.value;
  }
  return result;
}

export function snapshotDenseArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length');
  if (!lengthDescriptor || !('value' in lengthDescriptor)) {
    throw new TypeError(`${label} has invalid length`);
  }
  const length = lengthDescriptor.value as number;
  if (!Number.isSafeInteger(length) || length < 0 || length > 10_000) {
    throw new TypeError(`${label} length is out of bounds`);
  }
  const expectedKeys = Array.from({ length }, (_, index) => String(index));
  const elementKeys = Reflect.ownKeys(descriptors).filter((key) => key !== 'length');
  if (
    elementKeys.some((key) => typeof key !== 'string' || isUnsafeKey(key)) ||
    !hasExactKeys(
      Object.fromEntries(elementKeys.map((key) => [key, true])),
      expectedKeys
    )
  ) {
    throw new TypeError(`${label} must be dense without extra keys`);
  }
  return expectedKeys.map((key) => {
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable || !('value' in descriptor)) {
      throw new TypeError(`${label} accessor elements are forbidden`);
    }
    return descriptor.value;
  });
}

export function snapshotBytes(value: unknown, label: string): Uint8Array {
  if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype) {
    throw new TypeError(`${label} must be a Uint8Array`);
  }
  return Uint8Array.prototype.slice.call(value);
}

export function copyBytes(bytes: Uint8Array): Uint8Array {
  return Uint8Array.prototype.slice.call(bytes);
}

export function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export function hasUniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

export interface ValidationSnapshot<T> {
  readonly snapshot: T | null;
  readonly errors: readonly string[];
}

export function collectValidation<T>(
  validate: (snapshot: T) => readonly string[],
  snapshot: () => T
): ValidationSnapshot<T> {
  try {
    const value = snapshot();
    return { snapshot: value, errors: validate(value) };
  } catch (error) {
    return {
      snapshot: null,
      errors: [error instanceof Error ? error.message : 'invalid input'],
    };
  }
}
