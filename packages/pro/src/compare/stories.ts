/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Stories other than the main one: headers and footers of every section, footnotes, and
 * endnotes. Each compares with the same container engine, in its own part.
 */
import {
  resolveHeaderFooterResolutionBySection,
  serializeOoxmlPart,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import { notePlaceholder, type EmitContext, type NoteKind, type SectionReference } from './emit.ts';
import { compareContainer } from './story-compare.ts';
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
import { freePartName, isPartNameTaken, relatedPart, wordprocessingType } from './related-parts.ts';

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
  /** The main story's relationship id for the part. */
  readonly rId: string;
}

/**
 * The final section's headers and footers, by `kind:type`, exactly as the editor paints them:
 * the store's resolver checks each relationship's type, decodes its target, keeps the first
 * reference of a type, and carries a slot over from an earlier section that declares it.
 */
function furnitureRefs(pkg: OoxmlPackage): Map<string, FurnitureRef> {
  const sections = resolveHeaderFooterResolutionBySection(pkg);
  const final = sections[sections.length - 1];
  return final ? slotRefs(final) : new Map();
}

type SectionFurniture = ReturnType<typeof resolveHeaderFooterResolutionBySection>[number];

function slotRefs(section: SectionFurniture): Map<string, FurnitureRef> {
  const out = new Map<string, FurnitureRef>();
  for (const [kind, slots] of [
    ['header', section.headers],
    ['footer', section.footers],
  ] as const) {
    for (const [type, slot] of slots)
      out.set(`${kind}:${type}`, { kind, type, part: slot.part, rId: slot.rId });
  }
  return out;
}

/** Headers and footers that only earlier sections show, as `kind:type` plus content. */
function earlierFurniture(pkg: OoxmlPackage): Set<string> {
  const sections = resolveHeaderFooterResolutionBySection(pkg);
  const finalParts = finalSectionFurniture(pkg);
  const out = new Set<string>();
  for (const section of sections.slice(0, -1)) {
    for (const ref of slotRefs(section).values()) {
      if (finalParts.has(ref.part.name)) continue;
      const xml = serializeOoxmlPart(ref.part).replace(/\sw:rsid\w*="[^"]*"/g, '');
      out.add(`${ref.kind}:${ref.type}:${xml}`);
    }
  }
  return out;
}

interface FurniturePair {
  readonly base: FurnitureRef;
  /** Absent when the revised document shows nothing there: the content is deleted. */
  readonly revised: FurnitureRef | undefined;
}

interface EarlierFurniture {
  readonly pairs: FurniturePair[];
  /**
   * Slots only the revised document shows in an earlier section, with that section's index.
   * The output adds a reference to each in the original's section break.
   */
  readonly added: { readonly index: number; readonly ref: FurnitureRef }[];
}

const earlierCache = new WeakMap<OoxmlPackage, WeakMap<OoxmlPackage, EarlierFurniture | null>>();

/**
 * Original headers and footers that only earlier sections show, each paired with the revised
 * part that the same section and slot shows, plus the slots only the revised document shows
 * there. Sections pair by position when both documents have as many; otherwise those parts
 * must be the same in both. Null when a part cannot be paired: one original part would take
 * two different revised parts. An original part the revised document does not show is deleted.
 */
function earlierFurniturePairs(
  basePkg: OoxmlPackage,
  revisedPkg: OoxmlPackage
): EarlierFurniture | null {
  let byRevised = earlierCache.get(basePkg);
  if (!byRevised) earlierCache.set(basePkg, (byRevised = new WeakMap()));
  if (byRevised.has(revisedPkg)) return byRevised.get(revisedPkg)!;
  const result = pairEarlierFurniture(basePkg, revisedPkg);
  byRevised.set(revisedPkg, result);
  return result;
}

function pairEarlierFurniture(
  basePkg: OoxmlPackage,
  revisedPkg: OoxmlPackage
): EarlierFurniture | null {
  const baseSections = resolveHeaderFooterResolutionBySection(basePkg);
  const revisedSections = resolveHeaderFooterResolutionBySection(revisedPkg);
  if (baseSections.length !== revisedSections.length) {
    const base = earlierFurniture(basePkg);
    const revised = earlierFurniture(revisedPkg);
    const same = base.size === revised.size && [...base].every((entry) => revised.has(entry));
    return same ? { pairs: [], added: [] } : null;
  }
  // Each original part takes exactly one revised part, starting with the final section's.
  const target = new Map<string, string>();
  const finalBase = furnitureRefs(basePkg);
  const finalRevised = furnitureRefs(revisedPkg);
  for (const [key, ref] of finalBase)
    target.set(ref.part.name, finalRevised.get(key)?.part.name ?? '');
  const pairs: FurniturePair[] = [];
  const added: EarlierFurniture['added'] = [];
  for (let index = 0; index < baseSections.length - 1; index++) {
    const baseSlots = slotRefs(baseSections[index]!);
    const revisedSlots = slotRefs(revisedSections[index]!);
    for (const key of new Set([...baseSlots.keys(), ...revisedSlots.keys()])) {
      const base = baseSlots.get(key);
      const revised = revisedSlots.get(key);
      // A slot only the revised document shows takes a reference in this section. After a
      // reject its part is all deleted, which shows the same as no part here; the self-check
      // refuses the compare when a later section inherited the slot instead.
      if (!base) {
        added.push({ index, ref: revised! });
        continue;
      }
      const wanted = revised?.part.name ?? '';
      const mapped = target.get(base.part.name);
      if (mapped !== undefined) {
        if (mapped !== wanted) return null;
        continue;
      }
      target.set(base.part.name, wanted);
      pairs.push({ base, revised });
    }
  }
  return { pairs, added };
}

/** The part a header or footer only the revised final section shows takes in the output. */
function newFurniturePartName(basePkg: OoxmlPackage, ref: FurnitureRef): string {
  let partName = `/word/compare-${ref.kind}-${ref.type}.xml`;
  for (let n = 2; isPartNameTaken(basePkg, partName); n++)
    partName = `/word/compare-${ref.kind}-${ref.type}-${n}.xml`;
  return partName;
}

interface FurnitureOutputs {
  /** The output relationship id of each revised header or footer part, by part name. */
  readonly ids: Map<string, string>;
  /** The output part that holds a revised part's content all inserted, where there is one. */
  readonly insertedIds: Map<string, string>;
  /** Revised parts that slots added to earlier sections show: each gets a new inserted part. */
  readonly created: { readonly partName: string; readonly ref: FurnitureRef }[];
}

/**
 * Where each revised header or footer goes in the output: the original part of the final
 * section's slot, the original part an earlier section pairs it with, or a new part.
 */
function revisedFurnitureOutputs(
  basePkg: OoxmlPackage,
  revisedPkg: OoxmlPackage
): FurnitureOutputs {
  const ids = new Map<string, string>();
  // Output parts that hold a revised part's content all inserted, by revised part name.
  const insertedIds = new Map<string, string>();
  const finalBase = furnitureRefs(basePkg);
  const taken = new Set<string>();
  for (const [key, revised] of furnitureRefs(revisedPkg)) {
    const base = finalBase.get(key);
    let id = base?.rId;
    if (!id) {
      const partName = newFurniturePartName(basePkg, revised);
      taken.add(partName);
      id = `${MARK}NEW:${partName}§`;
      if (!insertedIds.has(revised.part.name)) insertedIds.set(revised.part.name, id);
    }
    if (!ids.has(revised.part.name)) ids.set(revised.part.name, id);
  }
  const earlier = earlierFurniturePairs(basePkg, revisedPkg);
  for (const { base, revised } of earlier?.pairs ?? []) {
    if (revised && !ids.has(revised.part.name)) ids.set(revised.part.name, base.rId);
  }
  // A slot only the revised document shows in an earlier section takes a part whose content
  // is all inserted, so a reject leaves it empty there. A part the original shows elsewhere
  // would bring back that part's original content instead.
  const created: FurnitureOutputs['created'][number][] = [];
  for (const { index, ref } of earlier?.added ?? []) {
    if (insertedIds.has(ref.part.name)) continue;
    const stem = `/word/compare-${ref.kind}-${ref.type}-s${index + 1}`;
    let partName = `${stem}.xml`;
    for (let n = 2; isPartNameTaken(basePkg, partName) || taken.has(partName); n++)
      partName = `${stem}-${n}.xml`;
    taken.add(partName);
    const id = `${MARK}NEW:${partName}§`;
    insertedIds.set(ref.part.name, id);
    if (!ids.has(ref.part.name)) ids.set(ref.part.name, id);
    created.push({ partName, ref });
  }
  return { ids, insertedIds, created };
}

/**
 * References the output adds to the original's earlier section breaks, by section index: one
 * for each header or footer slot only the revised document shows in that section.
 */
export function addedSectionReferences(
  basePkg: OoxmlPackage,
  revisedPkg: OoxmlPackage
): Map<number, SectionReference[]> {
  const { insertedIds } = revisedFurnitureOutputs(basePkg, revisedPkg);
  const out = new Map<number, SectionReference[]>();
  for (const { index, ref } of earlierFurniturePairs(basePkg, revisedPkg)?.added ?? []) {
    const list = out.get(index) ?? [];
    list.push({ kind: ref.kind, type: ref.type, id: insertedIds.get(ref.part.name)! });
    out.set(index, list);
  }
  return out;
}

/**
 * For each header or footer reference the revised main story declares, the relationship id
 * the output gives the same content: the original part it is compared into, or the new part
 * for content only the revised final section shows. A section break the revised document
 * adds then shows the compared header and footer after accept. References with no output
 * part are absent.
 */
export function furnitureOutputIds(
  basePkg: OoxmlPackage,
  revisedPkg: OoxmlPackage
): Map<string, string> {
  const byRevisedPart = revisedFurnitureOutputs(basePkg, revisedPkg).ids;
  const out = new Map<string, string>();
  for (const section of resolveHeaderFooterResolutionBySection(revisedPkg)) {
    for (const ref of slotRefs(section).values()) {
      const id = byRevisedPart.get(ref.part.name);
      if (id !== undefined && !out.has(ref.rId)) out.set(ref.rId, id);
    }
  }
  return out;
}

/** Names of the header and footer parts the final section of `pkg`'s main story shows. */
export function finalSectionFurniture(pkg: OoxmlPackage): ReadonlySet<string> {
  return new Set([...furnitureRefs(pkg).values()].map((ref) => ref.part.name));
}

/** One header or footer story compared, in the part the output gives it. */
function compareFurnitureStory(
  basePkg: OoxmlPackage,
  revisedPkg: OoxmlPackage,
  base: FurnitureRef | undefined,
  revised: FurnitureRef | undefined,
  ctx: EmitContext
): string {
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
  return storyXml(scope, root, () =>
    compareContainer(
      base ? unitsOf(base.part.root, baseSide) : [],
      revised ? unitsOf(revised.part.root, revisedSide) : [],
      story,
      !base || !revised
    )
  );
}

/**
 * Compares the final section's headers and footers by kind and type, then the original's parts
 * that only earlier sections show against the revised parts in the same place. `unpaired` when
 * an earlier section's header or footer cannot be paired, so its difference has no record.
 */
export function compareFurniture(
  basePkg: OoxmlPackage,
  revisedPkg: OoxmlPackage,
  ctx: EmitContext
): { readonly outputs: StoryOutput[]; readonly extraRefs: string; readonly unpaired: boolean } {
  const baseRefs = furnitureRefs(basePkg);
  const revisedRefs = furnitureRefs(revisedPkg);
  const outputs: StoryOutput[] = [];
  let extraRefs = '';
  for (const key of new Set([...baseRefs.keys(), ...revisedRefs.keys()])) {
    const base = baseRefs.get(key);
    const revised = revisedRefs.get(key);
    const xml = compareFurnitureStory(basePkg, revisedPkg, base, revised, ctx);
    if (base) {
      outputs.push({
        partName: base.part.name,
        contentType: base.part.contentType,
        xml,
        isNew: false,
      });
    } else {
      const ref = revised!;
      const partName = newFurniturePartName(basePkg, ref);
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
  const earlier = earlierFurniturePairs(basePkg, revisedPkg);
  for (const { base, revised } of earlier?.pairs ?? []) {
    outputs.push({
      partName: base.part.name,
      contentType: base.part.contentType,
      xml: compareFurnitureStory(basePkg, revisedPkg, base, revised, ctx),
      isNew: false,
    });
  }
  for (const { partName, ref } of revisedFurnitureOutputs(basePkg, revisedPkg).created) {
    outputs.push({
      partName,
      contentType: ref.part.contentType,
      xml: compareFurnitureStory(basePkg, revisedPkg, undefined, ref, ctx),
      isNew: true,
      relType: `${REL_BASE}/${ref.kind}`,
    });
  }
  return { outputs, extraRefs, unpaired: earlier === null };
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
    // The output separator of each type, so a reference to a separator keeps pointing at one.
    const separatorOf = new Map<string, string>();
    if (basePart) {
      for (const note of elementChildren(basePart.root)) {
        const id = attributeOf(note, 'id');
        const type = attributeOf(note, 'type');
        const revisedId = id === undefined ? undefined : pairs.get(id);
        const revisedNote = revisedId === undefined ? undefined : revisedNotes.get(revisedId);
        if (note.localName !== kind || (type && NOTE_SEPARATORS.has(type)) || id === undefined) {
          if (note.localName === kind && type && id !== undefined && !separatorOf.has(type))
            separatorOf.set(type, id);
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
          const type = attributeOf(note, 'type')!;
          if (!separatorOf.has(type)) separatorOf.set(type, id);
        }
        const xml = revisedSide.serialize(note);
        out +=
          id === own ? xml : xml.replace(/^(<[^>]*?\bw:id=")[^"]*"/, (_, head) => `${head}${id}"`);
      }
    }
    // A new id never takes one a reference in either document names without a note: those
    // references keep their own id and must keep resolving to nothing.
    const nextId = freeIds([
      ...baseNotes.keys(),
      ...copiedSeparators,
      ...baseReferences,
      ...referencedIds(revisedPkg, new Set([`${kind}Reference`]), 'id'),
    ]);
    for (const revisedId of added) {
      const note = revisedNotes.get(revisedId);
      if (!note || ids.has(revisedId)) continue;
      const type = attributeOf(note, 'type');
      if (type !== undefined && NOTE_SEPARATORS.has(type)) {
        // A reference to a separator is not a note of its own: it points at the output's
        // separator of that type, and a document without one cannot express it.
        const separator = separatorOf.get(type);
        if (separator === undefined) state.untracked++;
        else ids.set(revisedId, separator);
        continue;
      }
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
