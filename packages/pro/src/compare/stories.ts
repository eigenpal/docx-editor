/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Stories other than the main one: headers and footers of the final section, footnotes, and
 * endnotes. Each compares with the same container engine, in its own part.
 */
import { relationshipsOf, type OoxmlPackage, type OoxmlPart } from '@docx-editor.dev/core/store';
import { notePlaceholder, type EmitContext, type NoteKind } from './emit.ts';
import { compareContainer } from './story-compare.ts';
import { SideContext, unitsOf } from './units.ts';
import {
  attributeOf,
  childNamed,
  elementChildren,
  NamespaceScope,
  R_NS,
  shellOf,
  type ElementNode,
} from './xml-fragments.ts';

/** One output part. */
export interface StoryOutput {
  readonly partName: string;
  readonly contentType: string;
  readonly xml: string;
  /** The part does not exist in the original package. */
  readonly isNew: boolean;
  /** Relationship type from the main document part, for a new part. */
  readonly relType?: string;
}

const REL_BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** Builds a part's XML: the root shell (declared first), compared content, declarations. */
export function storyXml(
  scope: NamespaceScope,
  root: ElementNode,
  content: (shellDone: true) => string,
  wrap?: { readonly open: string; readonly close: string }
): string {
  const shell = shellOf(scope.serialize({ ...root, children: [] } as ElementNode));
  const inner = content(true);
  const start = shell.start.replace(/>$/, `${scope.declarations()}>`);
  return `${start}${wrap?.open ?? ''}${inner}${wrap?.close ?? ''}${shell.end}`;
}

function resolvePart(pkg: OoxmlPackage, owner: string, target: string): string {
  if (target.startsWith('/')) return target;
  const out = owner.split('/').slice(0, -1);
  for (const piece of target.split('/')) {
    if (piece === '..') out.pop();
    else if (piece !== '.' && piece !== '') out.push(piece);
  }
  const name = out.join('/');
  void pkg;
  return name.startsWith('/') ? name : `/${name}`;
}

interface FurnitureRef {
  readonly kind: 'header' | 'footer';
  readonly type: string;
  readonly part: OoxmlPart;
}

function furnitureRefs(
  pkg: OoxmlPackage,
  sectPr: ElementNode | undefined
): Map<string, FurnitureRef> {
  const out = new Map<string, FurnitureRef>();
  if (!sectPr) return out;
  const rels = relationshipsOf(pkg, pkg.mainDocumentPart);
  for (const ref of elementChildren(sectPr)) {
    if (ref.localName !== 'headerReference' && ref.localName !== 'footerReference') continue;
    const kind = ref.localName === 'headerReference' ? 'header' : 'footer';
    const type = attributeOf(ref, 'type') ?? 'default';
    const rid = attributeOf(ref, 'id', R_NS);
    const rel = rels.find((record) => record.id === rid);
    if (!rel) continue;
    const part = pkg.parts.get(resolvePart(pkg, pkg.mainDocumentPart, rel.rawTarget));
    if (part) out.set(`${kind}:${type}`, { kind, type, part });
  }
  return out;
}

/** Compares the final section's headers and footers by kind and type. */
export function compareFurniture(
  basePkg: OoxmlPackage,
  revisedPkg: OoxmlPackage,
  baseSect: ElementNode | undefined,
  revisedSect: ElementNode | undefined,
  ctx: EmitContext
): { readonly outputs: StoryOutput[]; readonly extraRefs: string } {
  const baseRefs = furnitureRefs(basePkg, baseSect);
  const revisedRefs = furnitureRefs(revisedPkg, revisedSect);
  const outputs: StoryOutput[] = [];
  let extraRefs = '';
  for (const key of new Set([...baseRefs.keys(), ...revisedRefs.keys()])) {
    const base = baseRefs.get(key);
    const revised = revisedRefs.get(key);
    const scope = new NamespaceScope();
    const baseSide = new SideContext(
      'base',
      basePkg,
      base?.part.name ?? basePkg.mainDocumentPart,
      scope
    );
    const revisedSide = new SideContext(
      'revised',
      revisedPkg,
      revised?.part.name ?? revisedPkg.mainDocumentPart,
      scope
    );
    const story = ctx.withSides(baseSide, revisedSide);
    const root = (base ?? revised)!.part.root as ElementNode;
    const xml = storyXml(scope, root, () =>
      compareContainer(
        base ? unitsOf(base.part.root, baseSide) : [],
        revised ? unitsOf(revised.part.root, revisedSide) : [],
        story,
        !base
      )
    );
    if (base) {
      outputs.push({
        partName: base.part.name,
        contentType: base.part.contentType,
        xml,
        isNew: false,
      });
    } else {
      const ref = revised!;
      const partName = `/word/compare-${ref.kind}-${ref.type}.xml`;
      outputs.push({
        partName,
        contentType: ref.part.contentType,
        xml,
        isNew: true,
        relType: `${REL_BASE}/${ref.kind}`,
      });
      extraRefs += `<w:${ref.kind}Reference w:type="${ref.type}" r:id="§NEW:${partName}§"/>`;
    }
  }
  return { outputs, extraRefs };
}

const NOTE_SEPARATORS = new Set(['separator', 'continuationSeparator', 'continuationNotice']);

function notesPart(pkg: OoxmlPackage, kind: NoteKind): OoxmlPart | undefined {
  for (const part of pkg.parts.values())
    if (part.contentType.endsWith(`.${kind}s+xml`)) return part;
  return undefined;
}

function notesById(part: OoxmlPart | undefined, kind: NoteKind): Map<string, ElementNode> {
  const out = new Map<string, ElementNode>();
  for (const note of part ? elementChildren(part.root) : []) {
    if (note.localName !== kind) continue;
    const id = attributeOf(note, 'id');
    if (id !== undefined) out.set(id, note);
  }
  return out;
}

/**
 * Compares the notes the main story's references point at. Matched references compare their
 * notes; added references bring their note as inserted content under a fresh id; removed
 * references delete their note's content.
 */
export function compareNotes(
  basePkg: OoxmlPackage,
  revisedPkg: OoxmlPackage,
  kind: NoteKind,
  ctx: EmitContext
): { readonly output: StoryOutput | null; readonly ids: ReadonlyMap<string, string> } {
  const state = ctx.state;
  const pairs = new Map(
    state.notePairs.filter((pair) => pair.kind === kind).map((pair) => [pair.base, pair.revised])
  );
  const deleted = new Set(
    state.deletedNotes.filter((note) => note.kind === kind).map((note) => note.base)
  );
  const added = state.newNotes.filter((note) => note.kind === kind).map((note) => note.revised);
  const basePart = notesPart(basePkg, kind);
  const revisedPart = notesPart(revisedPkg, kind);
  const ids = new Map<string, string>();
  if (pairs.size === 0 && deleted.size === 0 && added.length === 0) return { output: null, ids };
  const holder = basePart ?? revisedPart;
  if (!holder) return { output: null, ids };
  const baseNotes = notesById(basePart, kind);
  const revisedNotes = notesById(revisedPart, kind);
  const scope = new NamespaceScope();
  const baseSide = new SideContext(
    'base',
    basePkg,
    basePart?.name ?? basePkg.mainDocumentPart,
    scope
  );
  const revisedSide = new SideContext(
    'revised',
    revisedPkg,
    revisedPart?.name ?? revisedPkg.mainDocumentPart,
    scope
  );
  const story = ctx.withSides(baseSide, revisedSide);
  const noteShell = (note: ElementNode, side: SideContext, id?: string) => {
    const shell = shellOf(side.scope.serialize({ ...note, children: [] } as ElementNode));
    return {
      start: id === undefined ? shell.start : shell.start.replace(/\bw:id="[^"]*"/, `w:id="${id}"`),
      end: shell.end,
    };
  };
  const xml = storyXml(scope, holder.root as ElementNode, () => {
    let out = '';
    if (basePart) {
      for (const note of elementChildren(basePart.root)) {
        const id = attributeOf(note, 'id');
        const type = attributeOf(note, 'type');
        const revisedId = id === undefined ? undefined : pairs.get(id);
        const revisedNote = revisedId === undefined ? undefined : revisedNotes.get(revisedId);
        if (note.localName !== kind || (type && NOTE_SEPARATORS.has(type)) || id === undefined) {
          out += baseSide.serialize(note);
        } else if (revisedNote) {
          const shell = noteShell(note, baseSide);
          out +=
            shell.start +
            compareContainer(unitsOf(note, baseSide), unitsOf(revisedNote, revisedSide), story) +
            shell.end;
        } else if (deleted.has(id)) {
          const shell = noteShell(note, baseSide);
          out += shell.start + compareContainer(unitsOf(note, baseSide), [], story) + shell.end;
        } else {
          out += baseSide.serialize(note);
        }
      }
    } else if (revisedPart) {
      // A new notes part keeps the revised document's separators.
      for (const note of elementChildren(revisedPart.root)) {
        const type = attributeOf(note, 'type');
        if (type && NOTE_SEPARATORS.has(type)) out += revisedSide.serialize(note);
      }
    }
    let next = Math.max(0, ...[...baseNotes.keys()].map(Number).filter(Number.isFinite)) + 1;
    for (const revisedId of added) {
      const note = revisedNotes.get(revisedId);
      if (!note || ids.has(revisedId)) continue;
      const id = String(next++);
      ids.set(revisedId, id);
      const shell = noteShell(note, revisedSide, id);
      out +=
        shell.start + compareContainer([], unitsOf(note, revisedSide), story, true) + shell.end;
    }
    return out;
  });
  void childNamed;
  void notePlaceholder;
  return {
    output: {
      partName: basePart?.name ?? `/word/${kind}s.xml`,
      contentType: holder.contentType,
      xml,
      isNew: !basePart,
      relType: `${REL_BASE}/${kind}s`,
    },
    ids,
  };
}
