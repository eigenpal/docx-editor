import type {
  UnsupportedElement,
  UnsupportedElementRule,
} from '../layout/unsupported-content-types.ts';
import { createUnsupportedContentProjector } from '../layout/unsupported-content.ts';

/** Validate host geometry once, before a document layout pass. */
export function validateUnsupportedElementRules(
  rules: readonly UnsupportedElementRule[]
): readonly UnsupportedElementRule[] {
  return rules.map((rule) => {
    if (rule.match !== undefined && typeof rule.match !== 'function') {
      throw new TypeError('UnsupportedElement match must be a function.');
    }
    const layout = rule.layout;
    if (
      layout &&
      (!Number.isFinite(layout.width) ||
        !Number.isFinite(layout.height) ||
        layout.width <= 0 ||
        layout.height <= 0 ||
        layout.width > 100_000 ||
        layout.height > 100_000)
    )
      throw new RangeError(
        'UnsupportedElement layout requires positive dimensions up to 100000 points.'
      );
    return Object.freeze({ ...rule, ...(layout ? { layout: Object.freeze({ ...layout }) } : {}) });
  });
}

export function createUnsupportedElementProjection(rules: readonly UnsupportedElementRule[]) {
  const geometry = new Map<string, string>();
  const projector = createUnsupportedContentProjector((element: UnsupportedElement) => {
    const rule = rules.find((candidate) => candidate.match?.(element) ?? true);
    const size = rule
      ? (rule.layout ??
        (element.placement === 'block' ? { width: 240, height: 96 } : { width: 120, height: 24 }))
      : null;
    geometry.set(
      `${element.ownerPartName}\u0000${element.nodeId}`,
      size ? `${size.width},${size.height}` : 'hidden'
    );
    return size;
  });
  return {
    ...projector,
    geometryKey: () => JSON.stringify([...geometry].sort(([a], [b]) => a.localeCompare(b))),
  };
}

/** Keep live registrations across surface detach, reload, and reattachment. */
export function createUnsupportedElementState(
  initial: readonly UnsupportedElementRule[] | undefined,
  surface: () => {
    setUnsupportedElementRules(rules: readonly UnsupportedElementRule[]): void;
  } | null
) {
  let rules = validateUnsupportedElementRules(initial ?? []);
  return {
    current: () => rules,
    set(next: readonly UnsupportedElementRule[]) {
      const validated = validateUnsupportedElementRules(next);
      surface()?.setUnsupportedElementRules(validated);
      rules = validated;
    },
  };
}
