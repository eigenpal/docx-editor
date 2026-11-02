/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Stories other than the main one: headers and footers of the final section, footnotes, and
 * endnotes. Each compares with the same container engine, in its own part.
 */
import {
  resolveHeaderFooterResolutionBySection,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { notePlaceholder, type EmitContext, type NoteKind } from './emit.ts';
import { compareContainer } from './story-compare.ts';
import { partExists } from './package-assemble.ts';
import { freeIds, referencedIds } from './free-ids.ts';
import { MARK, SideContext, unitsOf } from './units.ts';
import {
  attributeOf,
  childNamed,
  elementChildren,
  NamespaceScope,
  R_NS,
  shellOf,
  type ElementNode,
} from './xml-fragments.ts';
import { freePartName, relatedPart, wordprocessingType } from './related-parts.ts';

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

interface FurnitureRef {
  readonly kind: 'header' | 'footer';
  readonly type: string;
  readonly part: OoxmlPart;
}

/**
 * The final section's headers and footers, by `kind:type`, exactly as the editor paints them:
 * the store's resolver checks each relationship's type, decodes its target, keeps the first
 * reference of a type, and carries a slot over from an earlier section that declares it.
 */
function furnitureRefs(pkg: OoxmlPackage): Map<string, FurnitureRef> {
  const out = new Map<string, FurnitureRef>();
  const sections = resolveHeaderFooterResolutionBySection(pkg);
  const final = sections[sections.length - 1];
  if (!final) return out;
  for (const [kind, slots] of [
    ['header', final.headers],
    ['footer', final.footers],
  ] as const) {
    for (const [type, slot] of slots) out.set(`${kind}:${type}`, { kind, type, part: slot.part });
  }
  return out;
}

/** Names of the header and footer parts the final section of `pkg`'s main story shows. */
export function finalSectionFurniture(pkg: OoxmlPackage): ReadonlySet<string> {
  return new Set([...furnitureRefs(pkg).values()].map((ref) => ref.part.name));
}

/** Compares the final section's headers and footers by kind and type. */
export function compareFurniture(
  basePkg: OoxmlPackage,
  revisedPkg: OoxmlPackage,
  ctx: EmitContext
): { readonly outputs: StoryOutput[]; readonly extraRefs: string } {
  const baseRefs = furnitureRefs(basePkg);
  const revisedRefs = furnitureRefs(revisedPkg);
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
        !base || !revised
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
      let partName = `/word/compare-${ref.kind}-${ref.type}.xml`;
      for (let n = 2; partExists(basePkg, partName); n++)
        partName = `/word/compare-${ref.kind}-${ref.type}-${n}.xml`;
      outputs.push({
        partName,
        contentType: ref.part.contentType,
        xml,
        isNew: true,
        relType: `${REL_BASE}/${ref.kind}`,
      });
      // Declared here: the original's main story need not declare the relationships namespace.
      extraRefs += `<w:${ref.kind}Reference xmlns:r="${R_NS}" w:type="${ref.type}" r:id="${MARK}NEW:${partName}§"/>`;
    }
  }
  return { outputs, extraRefs };
}

const NOTE_SEPARATORS = new Set(['separator', 'continuationSeparator', 'continuationNotice']);

/**
 * The story parts a compare reads, which the self-check verifies: the main story (found through
 * the package relationship, whatever content type it declares) first, then the final section's
 * headers and footers and the notes parts.
 */
export function comparedStoryParts(pkg: OoxmlPackage): OoxmlPart[] {
  const names = new Set<string>([pkg.mainDocumentPart, ...finalSectionFurniture(pkg)]);
  for (const kind of ['footnote', 'endnote'] as const) {
    const part = notesPart(pkg, kind);
    if (part) names.add(part.name);
  }
  return [...names].flatMap((name) => pkg.parts.get(name) ?? []);
}

const notesPart = (pkg: OoxmlPackage, kind: NoteKind): OoxmlPart | undefined =>
  relatedPart(pkg, `${kind}s`);

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
    const shell = shellOf(side.raw({ ...note, children: [] } as ElementNode));
    return {
      start: id === undefined ? shell.start : shell.start.replace(/\bw:id="[^"]*"/, `w:id="${id}"`),
      end: shell.end,
    };
  };
  const baseReferences = referencedIds(basePkg, new Set([`${kind}Reference`]), 'id');
  const xml = storyXml(scope, holder.root as ElementNode, () => {
    let out = '';
    const copiedSeparators: string[] = [];
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
          out +=
            shell.start + compareContainer(unitsOf(note, baseSide), [], story, true) + shell.end;
        } else {
          out += baseSide.serialize(note);
        }
      }
    } else if (revisedPart) {
      // A new notes part keeps the revised document's separators. One whose id the original
      // already references takes a free id, so that reference never resolves to a separator.
      const separators = elementChildren(revisedPart.root).filter((note) => {
        const type = attributeOf(note, 'type');
        return type !== undefined && NOTE_SEPARATORS.has(type);
      });
      const separatorIds = separators.map((note) => attributeOf(note, 'id') ?? '');
      const freeSeparatorId = freeIds([...baseReferences, ...separatorIds]);
      const taken = new Set(baseReferences);
      for (const note of separators) {
        const own = attributeOf(note, 'id');
        const id = own !== undefined && taken.has(own) ? freeSeparatorId() : own;
        if (id !== undefined) {
          taken.add(id);
          copiedSeparators.push(id);
        }
        const xml = revisedSide.serialize(note);
        out +=
          id === own ? xml : xml.replace(/^(<[^>]*?\bw:id=")[^"]*"/, (_, head) => `${head}${id}"`);
      }
    }
    const nextId = freeIds([...baseNotes.keys(), ...copiedSeparators, ...baseReferences]);
    for (const revisedId of added) {
      const note = revisedNotes.get(revisedId);
      if (!note || ids.has(revisedId)) continue;
      const id = nextId();
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
      partName: basePart?.name ?? freePartName(basePkg, `/word/${kind}s.xml`),
      contentType: basePart?.contentType ?? wordprocessingType(`${kind}s`),
      xml,
      isNew: !basePart,
      relType: `${REL_BASE}/${kind}s`,
    },
    ids,
  };
}
