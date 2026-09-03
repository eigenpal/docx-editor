// Visible cached text for atomic Word fields.
//
// Field instructions are inert source text. This walk exposes only saved result content.
// It follows the same typed run vocabulary as `paragraphTextOf`. Unknown generic content,
// drawings, and note references stay invisible. Nested fields expose their own results.
// Exhausting a field's node budget returns its atom placeholder. The walk fails soft and
// never makes a file-sized allocation.

import {
  collectFieldRunChildren,
  FIELD_ATOM_CHAR,
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_FIELD_NESTING,
  fieldResultInlineTextOf,
  isFldChar,
  isFldSimple,
  isInstrText,
  type AtomicFieldSpan,
  type FieldRunChildRef,
} from './field-nodes.ts';
import type { OoxmlNode, OoxmlParagraphNode } from './ooxml-tree.ts';

/** Review view applied to cached field-result content. */
export type FieldResultTextView = 'allMarkup' | 'original';

interface FieldState {
  readonly beginId: string;
  separated: boolean;
}

interface FieldMarkerPlan {
  readonly activeBegins: ReadonlySet<string>;
  readonly separateBegin: ReadonlyMap<string, string>;
  readonly endBegin: ReadonlyMap<string, string>;
}

interface ActiveComplexField {
  readonly span: AtomicFieldSpan;
  readonly owned: ReadonlySet<string>;
  readonly states: FieldState[];
  readonly markers: FieldMarkerPlan;
  readonly endId: string;
  readonly out: string[];
  readonly chars: CharacterBudget;
  nodesLeft: number;
  overflow: boolean;
}

/** Fixed node budget for one field's cached result. */
const MAX_FIELD_RESULT_NODES = 4_096;

/**
 * Fixed UTF-16 budget for one field's cached result.
 *
 * Sixteen instruction-sized buffers admit unusually long generated labels and references,
 * while capping the text that projection and case-folding can copy to about 128 KiB of UTF-16
 * payload per field. Lengths are checked before append; file-supplied strings are never sliced.
 */
export const MAX_FIELD_RESULT_CHARS = MAX_FIELD_INSTRUCTION_CHARS * 16;

interface CharacterBudget {
  left: number;
}

function appendResultText(out: string[], text: string, budget: CharacterBudget): boolean {
  if (text.length > budget.left) return false;
  budget.left -= text.length;
  if (text.length > 0) out.push(text);
  return true;
}

function statesAreVisible(states: readonly FieldState[]): boolean {
  for (const state of states) if (!state.separated) return false;
  return true;
}

function fieldMarkerPlan(
  entries: readonly FieldRunChildRef[],
  from = 0,
  to = entries.length,
  enclosingBeginId?: string
): FieldMarkerPlan {
  const activeBegins = new Set<string>();
  const separateBegin = new Map<string, string>();
  const endBegin = new Map<string, string>();
  const stack = enclosingBeginId ? [enclosingBeginId] : [];
  if (enclosingBeginId) activeBegins.add(enclosingBeginId);
  for (let index = from; index < to; index += 1) {
    const node = entries[index]!.node;
    if (isFldChar(node, 'begin')) {
      stack.push(node.id);
      continue;
    }
    if (isFldChar(node, 'separate')) {
      const beginId = stack[stack.length - 1];
      if (beginId) {
        activeBegins.add(beginId);
        separateBegin.set(node.id, beginId);
      }
      continue;
    }
    if (isFldChar(node, 'end')) {
      const beginId = stack.pop();
      if (beginId) {
        activeBegins.add(beginId);
        endBegin.set(node.id, beginId);
      }
    }
  }
  return { activeBegins, separateBegin, endBegin };
}

function consumeMarker(states: FieldState[], markers: FieldMarkerPlan, node: OoxmlNode): boolean {
  if (isFldChar(node, 'begin')) {
    if (markers.activeBegins.has(node.id)) states.push({ beginId: node.id, separated: false });
    return true;
  }
  if (isFldChar(node, 'separate')) {
    const beginId = markers.separateBegin.get(node.id);
    const state = states[states.length - 1];
    if (beginId && state?.beginId === beginId) state.separated = true;
    return true;
  }
  if (isFldChar(node, 'end')) {
    const beginId = markers.endBegin.get(node.id);
    const state = states[states.length - 1];
    if (beginId && state?.beginId === beginId) states.pop();
    return true;
  }
  return false;
}

function plainFieldResultText(
  node: OoxmlNode,
  view: FieldResultTextView,
  budget: { left: number },
  chars: CharacterBudget
): string | null {
  const initial: FieldRunChildRef[] = [];
  if (!collectFieldRunChildren(node, initial, budget)) return null;
  const pending = initial.reverse();
  const out: string[] = [];
  while (pending.length > 0) {
    const entry = pending.pop()!;
    if (view === 'original' && entry.hiddenInOriginal) continue;
    if (isFldSimple(entry.node)) {
      const nested: FieldRunChildRef[] = [];
      if (!collectFieldRunChildren(entry.node, nested, budget)) return null;
      for (let index = nested.length - 1; index >= 0; index -= 1) pending.push(nested[index]!);
      continue;
    }
    if (isInstrText(entry.node)) continue;
    const text = fieldResultInlineTextOf(entry.node);
    if (!appendResultText(out, text, chars)) return null;
  }
  return out.join('');
}

function scanSimpleEntries(
  entries: readonly FieldRunChildRef[],
  view: FieldResultTextView,
  budget: { left: number },
  chars: CharacterBudget,
  depth: number
): string | null {
  const out: string[] = [];
  const states: FieldState[] = [];
  const markers = fieldMarkerPlan(entries);
  for (const entry of entries) {
    const node = entry.node;
    if (consumeMarker(states, markers, node)) continue;
    if (isInstrText(node)) continue;
    if (!statesAreVisible(states)) continue;
    if (view === 'original' && entry.hiddenInOriginal) continue;
    if (isFldSimple(node)) {
      const nested =
        depth >= MAX_FIELD_NESTING
          ? plainFieldResultText(node, view, budget, chars)
          : simpleFieldResultText(node, view, budget, chars, depth + 1);
      if (nested === null) return null;
      // The recursive scan already charged every character to this field's shared budget.
      if (nested.length > 0) out.push(nested);
      continue;
    }
    const text = fieldResultInlineTextOf(node);
    if (!appendResultText(out, text, chars)) return null;
  }
  return out.join('');
}

function simpleFieldResultText(
  node: OoxmlNode,
  view: FieldResultTextView,
  budget: { left: number },
  chars: CharacterBudget,
  depth: number
): string | null {
  const entries: FieldRunChildRef[] = [];
  if (!collectFieldRunChildren(node, entries, budget)) return null;
  return scanSimpleEntries(entries, view, budget, chars, depth);
}

function consumeComplexEntry(
  active: ActiveComplexField,
  entry: FieldRunChildRef,
  view: FieldResultTextView
): boolean {
  const node = entry.node;
  if (active.owned.has(node.id)) {
    active.nodesLeft -= 1;
    if (active.nodesLeft < 0) active.overflow = true;
  }
  if (isFldChar(node, 'begin')) {
    if (node.id !== active.span.node.id && active.markers.activeBegins.has(node.id)) {
      active.states.push({ beginId: node.id, separated: false });
    }
    return false;
  }
  if (isFldChar(node, 'separate')) {
    const beginId = active.markers.separateBegin.get(node.id);
    const state = active.states[active.states.length - 1];
    if (beginId && state?.beginId === beginId) state.separated = true;
    return false;
  }
  if (isFldChar(node, 'end')) {
    if (node.id === active.endId) return true;
    const beginId = active.markers.endBegin.get(node.id);
    const state = active.states[active.states.length - 1];
    if (beginId && state?.beginId === beginId) active.states.pop();
    return false;
  }
  if (
    active.overflow ||
    isInstrText(node) ||
    isFldSimple(node) ||
    !active.owned.has(node.id) ||
    !statesAreVisible(active.states) ||
    (view === 'original' && entry.hiddenInOriginal)
  ) {
    return false;
  }
  const text = fieldResultInlineTextOf(node);
  if (!appendResultText(active.out, text, active.chars)) active.overflow = true;
  return false;
}

/** Visible cached results for all supplied atomic spans, from one paragraph scan. */
export function fieldResultTextsOf(
  paragraph: OoxmlParagraphNode,
  spans: readonly AtomicFieldSpan[],
  view: FieldResultTextView = 'allMarkup'
): ReadonlyMap<string, string> {
  const results = new Map<string, string>();
  const complexByBegin = new Map<string, AtomicFieldSpan>();
  const simpleByNode = new Map<string, AtomicFieldSpan>();
  for (const span of spans) {
    if (span.kind === 'complex') complexByBegin.set(span.node.id, span);
    else simpleByNode.set(span.node.id, span);
  }

  const entries: FieldRunChildRef[] = [];
  collectFieldRunChildren(paragraph, entries);
  const entryIndexById = new Map<string, number>();
  for (let index = 0; index < entries.length; index += 1) {
    entryIndexById.set(entries[index]!.node.id, index);
  }
  let active: ActiveComplexField | null = null;
  for (let entryIndex = 0; entryIndex < entries.length; entryIndex += 1) {
    const entry = entries[entryIndex]!;
    const simple = simpleByNode.get(entry.node.id);
    if (simple) {
      const budget = { left: MAX_FIELD_RESULT_NODES };
      const chars = { left: MAX_FIELD_RESULT_CHARS };
      const text = simpleFieldResultText(simple.node, view, budget, chars, 0);
      results.set(simple.node.id, text ?? FIELD_ATOM_CHAR);
    }

    if (active === null) {
      const complex = complexByBegin.get(entry.node.id);
      if (!complex) continue;
      const owned = new Set(complex.removeNodeIds);
      let endIndex = -1;
      for (let index = complex.removeNodeIds.length - 1; index >= 0; index -= 1) {
        const candidateIndex = entryIndexById.get(complex.removeNodeIds[index]!);
        if (candidateIndex === undefined || candidateIndex <= entryIndex) continue;
        if (isFldChar(entries[candidateIndex]!.node, 'end')) {
          endIndex = candidateIndex;
          break;
        }
      }
      const endEntry = entries[endIndex];
      if (!endEntry) {
        results.set(complex.node.id, FIELD_ATOM_CHAR);
        continue;
      }
      active = {
        span: complex,
        owned,
        states: [{ beginId: complex.node.id, separated: false }],
        markers: fieldMarkerPlan(entries, entryIndex + 1, endIndex, complex.node.id),
        endId: endEntry.node.id,
        out: [],
        chars: { left: MAX_FIELD_RESULT_CHARS },
        nodesLeft: MAX_FIELD_RESULT_NODES,
        overflow: false,
      };
    }

    if (consumeComplexEntry(active, entry, view)) {
      results.set(active.span.node.id, active.overflow ? FIELD_ATOM_CHAR : active.out.join(''));
      active = null;
    }
  }
  if (active !== null) results.set(active.span.node.id, FIELD_ATOM_CHAR);
  return results;
}
