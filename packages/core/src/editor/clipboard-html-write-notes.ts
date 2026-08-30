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
import type { RenderContext } from './clipboard-html-write.ts';

export type WordNoteKind = 'footnote' | 'endnote';

/** The note ids a notes part actually defines. */
export function noteIdsOf(root: OoxmlElement | null, kind: WordNoteKind): ReadonlySet<number> {
  const ids = new Set<number>();
  if (root === null) return ids;
  for (const child of root.children) {
    if (!isElement(child) || child.namespaceUri !== WML_NAMESPACE_URI) continue;
    if (child.localName !== kind) continue;
    const id = attributeValueOf(child, 'id', WML_NAMESPACE_URI);
    if (id !== undefined && /^[1-9]\d{0,4}$/.test(id)) ids.add(Number.parseInt(id, 10));
  }
  return ids;
}

function collectNoteReferences(
  node: OoxmlElement,
  out: Array<{ readonly kind: WordNoteKind; readonly id: number }>
): void {
  for (const child of node.children) {
    if (!isElement(child)) continue;
    if (
      child.namespaceUri === WML_NAMESPACE_URI &&
      (child.localName === 'footnoteReference' || child.localName === 'endnoteReference')
    ) {
      const raw = attributeValueOf(child, 'id', WML_NAMESPACE_URI);
      if (raw !== undefined && /^[1-9]\d{0,4}$/.test(raw)) {
        out.push({
          kind: child.localName === 'footnoteReference' ? 'footnote' : 'endnote',
          id: Number.parseInt(raw, 10),
        });
      }
      continue;
    }
    collectNoteReferences(child, out);
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
  roots: Record<WordNoteKind, OoxmlElement | null>
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
    const references: Array<{ readonly kind: WordNoteKind; readonly id: number }> = [];
    collectNoteReferences(element, references);
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
    if (id === undefined || !/^[1-9]\d{0,4}$/.test(id)) continue;
    // Same cap as wordNoteReferenceHtml, so no note body ships without its reference.
    const idValue = Number.parseInt(id, 10);
    if (idValue > 32_767) continue;
    // Only notes an emitted reference reaches (directly from the body, or through
    // the cross-note closure) — a note referenced solely inside a tracked deletion
    // must not ship a body the read lane would materialize as visible text.
    if (!shipped.has(idValue)) continue;
    const inner = renderBlocks(
      { ...ctx, noteBody: { kind, id: idValue }, docRels: noteRels },
      child.children
    );
    if (inner !== '')
      notes += `<div style="mso-element:${kind}" id="${kind === 'footnote' ? 'ftn' : 'edn'}${id}">${inner}</div>`;
  }
  return notes === '' ? '' : `<div style="mso-element:${kind}-list">${notes}</div>`;
}
