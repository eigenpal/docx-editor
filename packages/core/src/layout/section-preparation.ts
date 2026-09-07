/** Reconcile section preparation while keeping dependency validation with its owner. */
export function prepareSectionBlocks<Node extends object, Prepared>(
  bodies: readonly Node[],
  previous: { readonly bodies: readonly Node[]; readonly prepared: readonly Prepared[] } | null,
  prepare: (body: Node) => Prepared
): Prepared[] {
  if (!previous) return bodies.map(prepare);
  // Match shifted tails after insert/delete without allocating a document-sized map.
  // Equal-length edits can reuse aligned entries directly. Reorders conservatively
  // prepare moved blocks again; node IDs alone cannot prove an entry is reusable.
  let suffix = 0;
  if (bodies.length !== previous.bodies.length) {
    while (
      suffix < Math.min(bodies.length, previous.bodies.length) &&
      bodies[bodies.length - 1 - suffix] === previous.bodies[previous.bodies.length - 1 - suffix]
    )
      suffix += 1;
  }
  return bodies.map((body, index) => {
    if (body === previous.bodies[index]) return previous.prepared[index]!;
    if (index >= bodies.length - suffix) {
      return previous.prepared[index + previous.bodies.length - bodies.length]!;
    }
    return prepare(body);
  });
}

/** A text edit changes a paragraph root without changing its place in drawing order. */
export function sameSectionParagraphOrder(
  before: readonly { readonly kind: string; readonly id: string }[],
  after: readonly { readonly kind: string; readonly id: string }[]
): boolean {
  return (
    before.length === after.length &&
    before.every((node, index) => {
      const next = after[index]!;
      // A table's nested story order requires the exact subtree, not merely its ID.
      return (
        node === next ||
        (node.kind === 'paragraph' && next.kind === 'paragraph' && node.id === next.id)
      );
    })
  );
}

/** Column layout and wrap probes decide whether an authored paragraph frame participates. */
export function framePolicy(columns: number, disabled?: ReadonlySet<string>): string {
  if (columns !== 1) return 'columns';
  return disabled?.size ? JSON.stringify([...disabled].sort()) : 'body';
}
