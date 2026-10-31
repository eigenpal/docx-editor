// Direction wrappers around run content: `w:dir` (a directional embedding) and `w:bdo` (a
// directional override), ECMA-376 Part 1 §17.3.2.8 and §17.3.2.3.
//
// Layout resolves each wrapper as the matching Unicode explicit formatting character
// (UAX #9 X2-X6): LRE/RLE for an embedding, LRO/RLO for an override, closed by PDF. The
// characters exist only in the string handed to the bidi algorithm; their slots are removed
// again, so every level stays indexed by the paragraph's own UTF-16 offsets.
//
// The wrapper attribute is file-derived. Only the exact values `ltr` and `rtl` count; any
// other value leaves the content as plain runs.
import { WML_NAMESPACE_URI, type OoxmlElement } from '@docx-editor.dev/core/store';
import { bidiAlgorithm, type BidiEmbeddingLevels } from './bidi.ts';
import type { BidiDirective, FieldAwarePiece } from './field-pieces.ts';

export const NO_DIRECTIVES: readonly BidiDirective[] = Object.freeze([]);

/** The directive a `w:dir` or `w:bdo` element states, or `undefined`. */
export function bidiDirectiveOf(element: OoxmlElement): BidiDirective | undefined {
  if (element.namespaceUri !== WML_NAMESPACE_URI) return undefined;
  const kind =
    element.localName === 'bdo' ? 'override' : element.localName === 'dir' ? 'embedding' : null;
  if (!kind) return undefined;
  const values = element.attributes.filter(
    (attribute) => attribute.localName === 'val' && attribute.namespaceUri === WML_NAMESPACE_URI
  );
  const value = values.length === 1 ? values[0]!.value : undefined;
  return value === 'ltr' || value === 'rtl' ? { kind, direction: value } : undefined;
}

/** The pieces' stack of `w:dir` and `w:bdo` wrappers in a synchronous depth-first walk. */
export interface BidiDirectiveStack {
  /** The piece fields for the wrappers around the current position, outermost first. */
  fields(): { readonly bidiDirectives?: readonly BidiDirective[] };
  /** Enters an inline wrapper; the returned function restores the enclosing stack. */
  enter(element: OoxmlElement): () => void;
}

export function createBidiDirectiveStack(): BidiDirectiveStack {
  let current = NO_DIRECTIVES;
  return {
    fields: () => (current.length > 0 ? { bidiDirectives: current } : {}),
    enter(element) {
      const enclosing = current;
      const directive = bidiDirectiveOf(element);
      if (directive) current = [...enclosing, directive];
      return () => {
        current = enclosing;
      };
    },
  };
}

// Wrapper nesting is bounded by `MAX_INLINE_CONTAINER_DEPTH` (32), so the deepest level stays
// well under the 125 explicit levels UAX #9 allows.

// Bidi class B: a paragraph separator ends every embedding and override (UAX #9 X8).
const PARAGRAPH_SEPARATOR = /[\n\r\u001c-\u001e\u0085\u2029]/;

const OPEN: Readonly<Record<BidiDirective['kind'], Readonly<Record<'ltr' | 'rtl', string>>>> = {
  embedding: { ltr: '\u202A', rtl: '\u202B' },
  override: { ltr: '\u202D', rtl: '\u202E' },
};
const POP = '\u202C';

function sameDirective(a: BidiDirective, b: BidiDirective): boolean {
  return a.kind === b.kind && a.direction === b.direction;
}

/** Whether any piece sits inside a `w:dir` or `w:bdo` wrapper. */
export function hasBidiDirectives(pieces: readonly FieldAwarePiece[]): boolean {
  return pieces.some((piece) => (piece.bidiDirectives?.length ?? 0) > 0);
}

/** Whether any piece sits inside a right-to-left `w:dir` or `w:bdo` wrapper. */
export function hasRtlBidiDirective(pieces: readonly FieldAwarePiece[]): boolean {
  return pieces.some((piece) =>
    piece.bidiDirectives?.some((directive) => directive.direction === 'rtl')
  );
}

/** The direction an innermost override forces on its characters, or `undefined`. */
export function overrideDirection(piece: FieldAwarePiece): 'ltr' | 'rtl' | undefined {
  const innermost = piece.bidiDirectives?.at(-1);
  return innermost?.kind === 'override' ? innermost.direction : undefined;
}

/**
 * Embedding levels of `text`, which is the pieces' text joined (or a same-length stand-in for
 * it), with each piece's wrappers applied as explicit formatting characters. Pieces stay
 * whole: a wrapper boundary only falls between pieces.
 */
export function directedEmbeddingLevels(
  pieces: readonly FieldAwarePiece[],
  text: string,
  direction: 'ltr' | 'rtl'
): BidiEmbeddingLevels {
  const parts: string[] = [];
  const slots: number[] = [];
  let length = 0;
  let open: readonly BidiDirective[] = [];
  let offset = 0;
  for (const piece of pieces) {
    const wanted = piece.bidiDirectives ?? NO_DIRECTIVES;
    let shared = 0;
    while (
      shared < open.length &&
      shared < wanted.length &&
      sameDirective(open[shared]!, wanted[shared]!)
    )
      shared++;
    for (let close = open.length; close > shared; close--) {
      parts.push(POP);
      length++;
    }
    for (const directive of wanted.slice(shared)) {
      parts.push(OPEN[directive.kind][directive.direction]);
      length++;
    }
    open = wanted;
    const own = text.slice(offset, offset + piece.text.length);
    for (const unit of own) {
      for (let index = 0; index < unit.length; index++) slots.push(length + index);
      parts.push(unit);
      length += unit.length;
      // A line break inside a wrapper keeps the wrapper: open it again on the far side.
      if (!PARAGRAPH_SEPARATOR.test(unit)) continue;
      for (const directive of wanted) {
        parts.push(OPEN[directive.kind][directive.direction]);
        length++;
      }
    }
    offset += piece.text.length;
  }
  // Text past the pieces (none when `text` is their join) keeps the outer context.
  for (let close = open.length; close > 0; close--) parts.push(POP);
  const tail = text.slice(offset);
  const tailStart = length + open.length;
  for (let index = 0; index < tail.length; index++) slots.push(tailStart + index);
  parts.push(tail);
  const resolved = bidiAlgorithm.getEmbeddingLevels(parts.join(''), direction);
  const levels = new Uint8Array(slots.length);
  for (let index = 0; index < slots.length; index++)
    levels[index] = resolved.levels[slots[index]!]!;
  const base = direction === 'rtl' ? 1 : 0;
  return { levels, paragraphs: [{ start: 0, end: slots.length, level: base }] };
}
