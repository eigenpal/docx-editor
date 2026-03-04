import type { ParagraphContent, Run } from '../../types/document';

/**
 * Recursive deep equality for plain data objects (no functions, symbols, or
 * circular references). Handles `null`, `undefined`, arrays, and nested
 * objects with deterministic key comparison regardless of insertion order.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;

  if (a == null || b == null) return a === b;

  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  if (typeof a === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);

    if (aKeys.length !== bKeys.length) return false;

    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }

  return false;
}

export function extractRuns(content: ParagraphContent[]): Run[] {
  const runs: Run[] = [];

  for (const item of content) {
    if (item.type === 'run') {
      runs.push(item);
      continue;
    }

    if (item.type === 'hyperlink') {
      for (const child of item.children) {
        if (child.type === 'run') {
          runs.push(child);
        }
      }
    }
  }

  return runs;
}
