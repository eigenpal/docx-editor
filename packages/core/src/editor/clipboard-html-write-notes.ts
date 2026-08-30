// Footnote/endnote emission for the outbound clipboard HTML — split from
// clipboard-html-write.ts at the max-lines cap. The block renderer is injected, so
// the runtime dependency stays one-way.

import {
  WML_NAMESPACE_URI,
  type OoxmlElement,
  type OoxmlNode,
} from '../store/package/ooxml-tree.ts';
import { relationshipsOf } from '../store/package/package-edit.ts';
import { attributeValueOf } from '../store/store/tree-op-nodes.ts';
import { isElement } from './clipboard-html-write-tree.ts';
import type { FieldState, RenderContext } from './clipboard-html-write.ts';

export type WordNoteKind = 'footnote' | 'endnote';

/** One id parser for every site, so the cap cannot drift: a collected id the
 *  renderer would refuse would leave a dead anchor in the copied HTML. The store
 *  legitimately allocates ids up to int32 (striped collab ids), so the cap matches
 *  its NOTE_ID_MAX. Leading zeros are legal ST_DecimalNumber lexical forms;
 *  parseInt normalizes them so references and definitions agree on ONE spelling. */
function wmlNoteIdOf(raw: string | undefined): number | null {
  if (raw === undefined || !/^\d{1,10}$/.test(raw)) return null;
  const id = Number.parseInt(raw, 10);
  return id >= 1 && id <= 0x7fffffff ? id : null;
}

/** The note ids a notes part actually defines. */
export function noteIdsOf(root: OoxmlElement | null, kind: WordNoteKind): ReadonlySet<number> {
  const ids = new Set<number>();
  if (root === null) return ids;
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName !== kind) continue;
    const id = wmlNoteIdOf(attributeValueOf(child, 'id', WML_NAMESPACE_URI));
    if (id !== null) ids.add(id);
  }
  return ids;
}

type AdvanceFieldState = (node: OoxmlElement, fields: FieldState) => void;

/** Collect the citations the renderer would actually EMIT: content it suppresses
 *  (tracked deletions, complex-field instruction regions, directly vanished runs)
 *  must not ship a note body, or an anchor-less definition div pastes back as
 *  visible body text. Mirrors `renderRun`'s suppression order; style-cascaded
 *  vanish is not resolved here — a directly hidden citation is the real case. */
function collectNoteReferences(
  node: OoxmlElement,
  out: Array<{ readonly kind: WordNoteKind; readonly id: number }>,
  field: FieldState,
  advance: AdvanceFieldState
): void {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    // Deleted content never renders, but its fldChars still drive the state.
    if (child.kind === 'revisionDelete' || child.kind === 'revisionMoveFrom') {
      if (!field.inert) advance(child, field);
      continue;
    }
    if (child.kind === 'run') {
      if (child.children.some((inner) => inner.kind === 'fldChar')) {
        if (!field.inert) advance(child, field);
        continue;
      }
      if (child.children.some((inner) => inner.kind === 'instrText')) continue;
      if (!field.inert && field.stack.some((mode) => mode === 'instr')) continue;
      const rPr = child.children.find((inner) => inner.kind === 'runProperties');
      if (rPr && isElement(rPr)) {
        const vanish = rPr.children.find(
          (inner) =>
            isElement(inner) &&
            inner.namespaceUri === WML_NAMESPACE_URI &&
            inner.localName === 'vanish'
        );
        if (vanish && isElement(vanish)) {
          const val = attributeValueOf(vanish, 'val', WML_NAMESPACE_URI);
          if (!(val === '0' || val === 'false' || val === 'off')) continue;
        }
      }
    }
    if (
      child.namespaceUri === WML_NAMESPACE_URI &&
      (child.localName === 'footnoteReference' || child.localName === 'endnoteReference')
    ) {
      const id = wmlNoteIdOf(attributeValueOf(child, 'id', WML_NAMESPACE_URI));
      if (id !== null) {
        out.push({
          kind: child.localName === 'footnoteReference' ? 'footnote' : 'endnote',
          id,
        });
      }
      continue;
    }
    collectNoteReferences(child, out, field, advance);
  }
}

function noteElementOf(
  root: OoxmlElement | null,
  kind: WordNoteKind,
  id: number
): OoxmlElement | null {
  if (root === null) return null;
  const wanted = String(id);
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName !== kind) continue;
    if (attributeValueOf(child, 'id', WML_NAMESPACE_URI) === wanted) return child;
  }
  return null;
}

/**
 * The notes to ship: everything the body referenced (an ordinal exists) plus the
 * CLOSURE over cross-note references, so a note cited only from another note's
 * body still ships its definition instead of leaving a dead anchor.
 */
export function shippedNoteIds(
  ctx: RenderContext,
  roots: Record<WordNoteKind, OoxmlElement | null>,
  advance: AdvanceFieldState
): Record<WordNoteKind, Set<number>> {
  const shipped: Record<WordNoteKind, Set<number>> = {
    footnote: new Set(ctx.noteOrdinals.footnote.keys()),
    endnote: new Set(ctx.noteOrdinals.endnote.keys()),
  };
  const queue: Array<{ kind: WordNoteKind; id: number }> = [];
  for (const kind of ['footnote', 'endnote'] as const) {
    for (const id of shipped[kind]) queue.push({ kind, id });
  }
  while (queue.length > 0) {
    const current = queue.pop()!;
    const element = noteElementOf(roots[current.kind], current.kind, current.id);
    if (element === null) continue;
    // The same balance probe renderNoteList's block render runs: an unbalanced
    // note body disarms the field machinery, so its citations DO render there.
    const probe: FieldState = { stack: [], inert: false };
    advance(element, probe);
    const field: FieldState = { stack: [], inert: probe.stack.length > 0 };
    const references: Array<{ readonly kind: WordNoteKind; readonly id: number }> = [];
    collectNoteReferences(element, references, field, advance);
    for (const reference of references) {
      if (!ctx.availableNotes[reference.kind].has(reference.id)) continue;
      if (shipped[reference.kind].has(reference.id)) continue;
      shipped[reference.kind].add(reference.id);
      queue.push(reference);
    }
  }
  return shipped;
}

export function renderNoteList(
  ctx: RenderContext,
  kind: WordNoteKind,
  root: OoxmlElement | null,
  shipped: ReadonlySet<number>,
  renderBlocks: (ctx: RenderContext, children: readonly OoxmlNode[]) => string
): string {
  if (root === null) return '';
  let ownerPart = `/word/${kind}s.xml`;
  for (const [name, part] of ctx.pkg.parts) {
    if (part.root === root) ownerPart = name;
  }
  const noteRels = relationshipsOf(ctx.pkg, ownerPart);
  let notes = '';
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName !== kind) continue;
    const id = attributeValueOf(child, 'id', WML_NAMESPACE_URI);
    const idValue = wmlNoteIdOf(id);
    if (id === undefined || idValue === null) continue;
    // Only notes an emitted reference reaches (directly from the body, or through
    // the cross-note closure) — a note referenced solely inside a tracked deletion
    // must not ship a body the read lane would materialize as visible text.
    if (!shipped.has(idValue)) continue;
    const inner = renderBlocks(
      { ...ctx, noteBody: { kind, id: idValue }, docRels: noteRels },
      child.children
    );
    // A shipped id always gets its definition div — its anchor is already in the
    // body, and a dead anchor would paste back as literal text. An empty body
    // renders as an empty paragraph.
    notes += `<div style="mso-element:${kind}" id="${kind === 'footnote' ? 'ftn' : 'edn'}${idValue}">${
      inner === '' ? '<p></p>' : inner
    }</div>`;
  }
  return notes === '' ? '' : `<div style="mso-element:${kind}-list">${notes}</div>`;
}
