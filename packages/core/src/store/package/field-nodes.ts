// Typed field vocabulary helpers (`w:fldChar`, `w:instrText`, `w:fldSimple`).
//
// Canonical nodes preserve schema order and authored attributes (`w:fldCharType`,
// `w:dirty`, `w:fldLock`, `w:instr`). Legacy `CT_FldChar/w:ffData` (including
// entryMacro/exitMacro) stays generic payload under `fldChar` — never walked for
// evaluation, never auto-resolved, never executed.
//
// Well-formed complex fields (begin→end within one paragraph) and `fldSimple` each
// contribute exactly one UTF-16 unit ({@link FIELD_ATOM_CHAR}) to paragraph addressing.
// Cached result text is not independently addressable. Malformed fields demote: markers
// contribute nothing and interior result text remains visible/addressable so content
// never disappears.

import { WML_NAMESPACE_URI } from './ooxml-shared.ts';
import type {
  OoxmlFldCharNode,
  OoxmlFldSimpleNode,
  OoxmlInstrTextNode,
  OoxmlNode,
  OoxmlParagraphNode,
} from './ooxml-tree.ts';

/** UTF-16 placeholder for one atomic field unit in `paragraphTextOf` / segments. */
export const FIELD_ATOM_CHAR = '\uFFFC';

export type FldCharType = 'begin' | 'separate' | 'end';

const FLD_CHAR_TYPES: ReadonlySet<string> = new Set(['begin', 'separate', 'end']);

function attributeValue(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes) {
    if (entry.namespaceUri === WML_NAMESPACE_URI && entry.localName === localName) {
      return entry.value;
    }
    // Unprefixed attributes on WML elements are common in authored packages.
    if (entry.namespaceUri === '' && entry.localName === localName) return entry.value;
  }
  return undefined;
}

function isWml(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    node.localName === localName
  );
}

/** Read `@w:fldCharType` when present and schema-legal. */
export function fldCharType(node: OoxmlNode): FldCharType | null {
  if (!isWml(node, 'fldChar')) return null;
  const value = attributeValue(node, 'fldCharType');
  if (value === 'begin' || value === 'separate' || value === 'end') return value;
  return null;
}

export function isFldCharNode(node: OoxmlNode): node is OoxmlFldCharNode {
  return node.kind === 'fldChar';
}

export function isInstrTextNode(node: OoxmlNode): node is OoxmlInstrTextNode {
  return node.kind === 'instrText';
}

export function isFldSimpleNode(node: OoxmlNode): node is OoxmlFldSimpleNode {
  return node.kind === 'fldSimple';
}

/** Typed or generic `w:fldChar` with the given type. */
export function isFldChar(node: OoxmlNode, type: FldCharType): boolean {
  return fldCharType(node) === type;
}

/** Typed or generic `w:instrText`. */
export function isInstrText(node: OoxmlNode): boolean {
  return node.kind === 'instrText' || (node.kind === 'generic' && isWml(node, 'instrText'));
}

/** Typed or generic `w:fldSimple`. */
export function isFldSimple(node: OoxmlNode): boolean {
  return node.kind === 'fldSimple' || (node.kind === 'generic' && isWml(node, 'fldSimple'));
}

/** Concatenated text descendants of `w:instrText` (instruction only — never executed). */
export function instrTextValue(node: OoxmlNode): string {
  if (!isInstrText(node) || node.kind === 'textValue') return '';
  let text = '';
  const stack: OoxmlNode[] = [...(node.children ?? [])];
  while (stack.length > 0) {
    const next = stack.pop()!;
    if (next.kind === 'textValue') {
      text = next.value + text;
      continue;
    }
    for (const child of next.children ?? []) stack.push(child);
  }
  return text;
}

/** `@w:instr` on `w:fldSimple`, or undefined when absent. */
export function fldSimpleInstr(node: OoxmlNode): string | undefined {
  if (!isFldSimple(node)) return undefined;
  return attributeValue(node, 'instr');
}

/**
 * Read an on/off WML attribute (`dirty` / `fldLock`).
 *
 * Returns `undefined` when absent, otherwise the OOXML on/off interpretation
 * (present without val, or val not explicitly off → true).
 */
export function fieldOnOffAttribute(
  node: OoxmlNode,
  localName: 'dirty' | 'fldLock'
): boolean | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  const raw = attributeValue(node, localName);
  if (raw === undefined) {
    // Attribute missing entirely.
    const present = node.attributes.some(
      (entry) =>
        entry.localName === localName &&
        (entry.namespaceUri === WML_NAMESPACE_URI || entry.namespaceUri === '')
    );
    return present ? true : undefined;
  }
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

/** Model text contributed by one atomic field unit. */
export function fieldAtomText(): typeof FIELD_ATOM_CHAR {
  return FIELD_ATOM_CHAR;
}

/**
 * True when a node is field chrome that never contributes its own model text outside
 * an atomic span (markers + instruction). Cached result `w:t` is separate.
 */
export function isFieldChrome(node: OoxmlNode): boolean {
  const type = fldCharType(node);
  if (type !== null) return true;
  return isInstrText(node);
}

/**
 * One atomic field span inside a paragraph for caret / delete / selection.
 *
 * `removeNodeIds` lists every node that must leave with the unit (begin…end chrome and
 * cached-result content for complex fields; the `fldSimple` element for simple fields).
 */
export interface AtomicFieldSpan {
  readonly kind: 'complex' | 'simple';
  /** Addressable segment node (begin `fldChar` or `fldSimple`). */
  readonly node: OoxmlNode;
  /** Run that owns the begin marker; empty string for paragraph-level `fldSimple`. */
  readonly runId: string;
  readonly removeNodeIds: readonly string[];
}

interface RunChildRef {
  readonly runId: string;
  readonly node: OoxmlNode;
}

/**
 * Collect well-formed atomic field spans in document order.
 *
 * Demotion (no span emitted — callers surface interior text normally):
 * - `end` without matching `begin`
 * - orphan `instrText` outside an open field
 * - missing `end` before paragraph end
 * - nesting deeper than `maxNesting`
 * - instruction longer than `maxInstructionChars` (still forms a span when begin/end
 *   pair closes, but callers may treat evaluation as inert; addressing stays atomic)
 *
 * Cross-paragraph fields never form: this walk is per paragraph.
 */
export function atomicFieldSpansOf(
  paragraph: OoxmlParagraphNode,
  options?: { readonly maxNesting?: number; readonly maxInstructionChars?: number }
): readonly AtomicFieldSpan[] {
  const maxNesting = options?.maxNesting ?? 4;
  const maxInstructionChars = options?.maxInstructionChars ?? 256;
  const spans: AtomicFieldSpan[] = [];

  // Flatten run children in document order for the complex-field machine.
  // Hyperlink is a run container: fields inside a link are ordinary paragraph text.
  const flat: RunChildRef[] = [];
  const visitInline = (child: OoxmlNode): void => {
    if (child.kind === 'fldSimple' || (child.kind === 'generic' && isFldSimple(child))) {
      spans.push({
        kind: 'simple',
        node: child,
        runId: '',
        removeNodeIds: [child.id],
      });
      return;
    }
    if (child.kind === 'run') {
      for (const grand of child.children) {
        if (grand.kind === 'runProperties') continue;
        flat.push({ runId: child.id, node: grand });
      }
      return;
    }
    if (child.kind === 'hyperlink') {
      for (const inner of child.children) visitInline(inner);
    }
  };
  for (const child of paragraph.children) visitInline(child);

  let i = 0;
  while (i < flat.length) {
    const current = flat[i]!;
    if (!isFldChar(current.node, 'begin')) {
      i += 1;
      continue;
    }

    // Scan forward for a matching outermost end; track nesting and instruction size.
    let nesting = 0;
    let nestingOverflow = false;
    let instructionChars = 0;
    let instructionOverflow = false;
    let phase: 'instruction' | 'result' | 'done' = 'instruction';
    const removeIds: string[] = [];
    let endIndex = -1;

    for (let j = i; j < flat.length; j += 1) {
      const entry = flat[j]!;
      const node = entry.node;

      if (isFldChar(node, 'begin')) {
        nesting += 1;
        if (nesting > maxNesting) nestingOverflow = true;
        removeIds.push(node.id);
        // ffData and other generic children stay under fldChar — listed via the parent id
        // removal (subtree). Do not execute or resolve them.
        continue;
      }

      if (isInstrText(node)) {
        if (nesting === 1 && phase === 'instruction') {
          const chunk = instrTextValue(node);
          instructionChars += chunk.length;
          if (instructionChars > maxInstructionChars) instructionOverflow = true;
        }
        if (nesting >= 1) removeIds.push(node.id);
        continue;
      }

      if (isFldChar(node, 'separate')) {
        if (nesting === 1 && phase === 'instruction') phase = 'result';
        if (nesting >= 1) removeIds.push(node.id);
        continue;
      }

      if (isFldChar(node, 'end')) {
        if (nesting >= 1) removeIds.push(node.id);
        nesting -= 1;
        if (nesting === 0) {
          phase = 'done';
          endIndex = j;
          break;
        }
        continue;
      }

      // Interior content: instruction-phase run content is chrome (skipped for addressing);
      // result-phase measurable content is part of the atomic unit (removed on delete).
      if (nesting >= 1) {
        if (phase === 'result' && nesting === 1) {
          if (
            node.kind === 'text' ||
            node.kind === 'tab' ||
            node.kind === 'hardBreak' ||
            node.kind === 'textValue'
          ) {
            removeIds.push(node.id);
          } else if (node.kind === 'generic') {
            // Non-text generic inside result stays with the field on delete.
            removeIds.push(node.id);
          }
        } else if (phase === 'instruction') {
          removeIds.push(node.id);
        }
      }
    }

    if (endIndex < 0 || nestingOverflow) {
      // Demote: missing end or hostile nesting — do not emit an atomic span.
      i += 1;
      continue;
    }

    // Instruction overflow still yields an atomic unit (content stays one selectable
    // object); evaluation elsewhere fails closed. `instructionOverflow` is retained for
    // callers that want the signal via a separate scan.
    void instructionOverflow;

    spans.push({
      kind: 'complex',
      node: current.node,
      runId: current.runId,
      removeNodeIds: [...new Set(removeIds)],
    });
    i = endIndex + 1;
  }

  return spans;
}

/** Whether `fldCharType` is a legal ST_FldCharType value (used by tests / guards). */
export function isLegalFldCharType(value: string): boolean {
  return FLD_CHAR_TYPES.has(value);
}
