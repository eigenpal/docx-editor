// Shared bounded scalar and direct-child readers for DrawingML geometry.
import { isElement } from './drawing-projection-walk.ts';
import type { OoxmlElement, OoxmlNode } from './ooxml-tree.ts';

export const MAX_EMU = 2 ** 31 - 1;

export function parseEmu(value: string | undefined, clamp = true): number | null {
  if (value === undefined || !/^-?\d{1,15}$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (!clamp) return parsed;
  if (parsed < 0) return 0;
  if (parsed > MAX_EMU) return MAX_EMU;
  return parsed;
}

/**
 * A non-negative size in EMU; `fallback` when the value is absent or not a number; null when
 * it is negative. The clamped `parseEmu` read turns a negative value into 0, which would admit
 * an invalid size as a zero-width line, so the sign is checked first.
 */
export function readSize(raw: string | undefined, fallback: number | null): number | null {
  const signed = parseEmu(raw, false);
  if (signed === null) return fallback;
  return signed < 0 ? null : Math.min(signed, MAX_EMU);
}

export function findDirectChild(
  nodes: readonly OoxmlNode[],
  options: {
    readonly typedKind?: string;
    readonly namespaceUri?: string;
    readonly localName?: string;
  }
): OoxmlElement | null {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (options.typedKind !== undefined && node.kind === options.typedKind) return node;
    if (
      options.namespaceUri !== undefined &&
      options.localName !== undefined &&
      node.kind === 'generic' &&
      node.namespaceUri === options.namespaceUri &&
      node.localName === options.localName
    ) {
      return node;
    }
  }
  return null;
}
