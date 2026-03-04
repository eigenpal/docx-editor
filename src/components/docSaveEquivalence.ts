import type { Document, HeaderFooter } from '../types/document';

function safeStringify(value: unknown): string | null {
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function areComparableValuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  const left = safeStringify(a);
  if (left === null) {
    return false;
  }

  const right = safeStringify(b);
  return right !== null && left === right;
}

function areHeaderFooterMapsEqual(
  a: Map<string, HeaderFooter> | undefined,
  b: Map<string, HeaderFooter> | undefined
): boolean {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return !a && !b;
  }
  if (a.size !== b.size) {
    return false;
  }

  for (const [key, leftValue] of a.entries()) {
    if (!b.has(key)) {
      return false;
    }

    const rightValue = b.get(key);
    if (!areComparableValuesEqual(leftValue, rightValue)) {
      return false;
    }
  }

  return true;
}

function serializeHeaderFooterMap(
  map: Map<string, HeaderFooter> | undefined
): Array<[string, string | null]> | null {
  if (!map) {
    return null;
  }

  const entries = Array.from(map.entries())
    .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
    .map(([key, value]) => [key, safeStringify(value)] as [string, string | null]);

  return entries;
}

/**
 * Compare the document parts that this editor currently modifies.
 * If these parts are equal, we can safely return the baseline binary unchanged.
 */
export function areDocumentsSaveEquivalent(current: Document, baseline: Document): boolean {
  if (!areComparableValuesEqual(current.package.document, baseline.package.document)) {
    return false;
  }

  if (!areHeaderFooterMapsEqual(current.package.headers, baseline.package.headers)) {
    return false;
  }

  if (!areHeaderFooterMapsEqual(current.package.footers, baseline.package.footers)) {
    return false;
  }

  if (!areComparableValuesEqual(current.package.footnotes, baseline.package.footnotes)) {
    return false;
  }

  if (!areComparableValuesEqual(current.package.endnotes, baseline.package.endnotes)) {
    return false;
  }

  return true;
}

export function cloneArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

function cloneValueForBaseline<T>(value: T, seen: WeakMap<object, unknown>): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value) as T;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }

  if (value instanceof ArrayBuffer) {
    return value.slice(0) as T;
  }

  if (ArrayBuffer.isView(value)) {
    if (value instanceof DataView) {
      const copied = value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength);
      return new DataView(copied) as T;
    }
    const sliceCandidate = (value as { slice?: unknown }).slice;
    if (typeof sliceCandidate === 'function') {
      return (sliceCandidate as () => T).call(value);
    }
  }

  if (value instanceof Map) {
    const cloned = new Map();
    seen.set(value, cloned);
    for (const [key, mapValue] of value.entries()) {
      cloned.set(cloneValueForBaseline(key, seen), cloneValueForBaseline(mapValue, seen));
    }
    return cloned as T;
  }

  if (value instanceof Set) {
    const cloned = new Set();
    seen.set(value, cloned);
    for (const setValue of value.values()) {
      cloned.add(cloneValueForBaseline(setValue, seen));
    }
    return cloned as T;
  }

  if (Array.isArray(value)) {
    const clonedArray: unknown[] = [];
    seen.set(value, clonedArray);
    for (const entry of value) {
      clonedArray.push(cloneValueForBaseline(entry, seen));
    }
    return clonedArray as T;
  }

  const clonedObject = Object.create(Object.getPrototypeOf(value)) as Record<PropertyKey, unknown>;
  seen.set(value, clonedObject);
  const descriptors = Object.getOwnPropertyDescriptors(value) as Record<
    PropertyKey,
    PropertyDescriptor
  >;
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (!descriptor) continue;
    if ('value' in descriptor) {
      descriptor.value = cloneValueForBaseline(descriptor.value, seen);
    }
    Object.defineProperty(clonedObject, key, descriptor);
  }
  return clonedObject as T;
}

/**
 * Build a deterministic signature for sections covered by no-op save checks.
 * This avoids false no-op detection when object references are mutated in place.
 */
export function createSaveEquivalenceSignature(document: Document): string {
  const payload = {
    document: safeStringify(document.package.document),
    headers: serializeHeaderFooterMap(document.package.headers),
    footers: serializeHeaderFooterMap(document.package.footers),
    footnotes: safeStringify(document.package.footnotes),
    endnotes: safeStringify(document.package.endnotes),
  };
  return JSON.stringify(payload);
}

/**
 * Defensive deep clone for baseline snapshots.
 * Uses structuredClone where available; falls back to a deterministic recursive clone otherwise.
 */
export function cloneDocumentForBaseline(document: Document): Document {
  if (typeof structuredClone === 'function') {
    return structuredClone(document);
  }
  return cloneValueForBaseline(document, new WeakMap());
}
