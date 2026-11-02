/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * Document compare: the original with the revised document's differences as tracked changes.
 *
 * DOM-free and layout-free. Both inputs are compared in their accepted state; the output is
 * the original package with compared stories and any parts, relationships, and media that
 * content taken from the revised document needs.
 */
import {
  applyTreeOp,
  readOoxmlPackage,
  type OoxmlNode,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { CompareDocumentsOptions, CompareDocumentsResult } from './compare-types.ts';

/** {@link comparePackages} result: the public result plus the output package. */
export type ComparePackagesResult =
  | {
      readonly ok: true;
      readonly bytes: Uint8Array;
      readonly package: OoxmlPackage;
      readonly revisionCount: number;
    }
  | Extract<CompareDocumentsResult, { ok: false }>;
import { CompareState, EmitContext, NOTE_PLACEHOLDER, sectPrXml, type NoteKind } from './emit.ts';
import { fromPlaceholder } from './units.ts';
import { assemblePackage } from './package-assemble.ts';
import { mergeDefinitions } from './definitions.ts';
import { mergeComments } from './comments.ts';
import { hasRevision, selfCheck } from './self-check.ts';
import {
  compareFurniture,
  compareNotes,
  furnitureOutputIds,
  storyXml,
  type StoryOutput,
} from './stories.ts';
import { compareContainer } from './story-compare.ts';
import { SideContext, unitsOf } from './units.ts';
import {
  attributeOf,
  escapeAttribute,
  childNamed,
  elementChildren,
  isElement,
  NamespaceScope,
  type ElementNode,
} from './xml-fragments.ts';
import { pushAll } from './arrays.ts';
import { relatedPart } from './related-parts.ts';

/** Inputs larger than this many blocks (paragraphs, tables, rows, cells) are refused. */
/**
 * Blocks over both documents' story parts. Cost is linear in blocks, at about a fifth of a
 * millisecond each, so the bound keeps the worst case near ten seconds; a 500-page document
 * holds some thirteen thousand.
 */
const MAX_BLOCKS = 100_000;
/**
 * The compare keeps per-character state for every story; text over this many UTF-16 code units
 * in both documents together is refused before any work (about two 1,300-page documents).
 */
const MAX_TEXT_UNITS = 1_500_000;
/** Roots of the parts a compare reads; a file's declared content type is not trusted. */
// Definition parts count too: the list and style merges walk every definition and instance.
const STORY_ROOTS = new Set([
  'document',
  'hdr',
  'ftr',
  'footnotes',
  'endnotes',
  'comments',
  'numbering',
  'styles',
]);

export function compareDocuments(
  original: Uint8Array,
  revised: Uint8Array,
  options: CompareDocumentsOptions = {}
): CompareDocumentsResult {
  const baseRead = readOoxmlPackage(original);
  if (!baseRead.ok) {
    return {
      ok: false,
      code: 'invalid-original',
      message: `The original document cannot be read (${baseRead.reason}).`,
    };
  }
  const revisedRead = readOoxmlPackage(revised);
  if (!revisedRead.ok) {
    return {
      ok: false,
      code: 'invalid-revised',
      message: `The revised document cannot be read (${revisedRead.reason}).`,
    };
  }
  const result = comparePackages(baseRead.package, revisedRead.package, options);
  return result.ok
    ? { ok: true, bytes: result.bytes, revisionCount: result.revisionCount }
    : result;
}

export function comparePackages(
  original: OoxmlPackage,
  revised: OoxmlPackage,
  options: CompareDocumentsOptions = {},
  /** @internal Diagnostics only: return the result even when the self-check fails. */
  unchecked = false
): ComparePackagesResult {
  if (protectedAgainstEdits(original, options.detectFormatChanges ?? true)) {
    return {
      ok: false,
      code: 'protected',
      message:
        'The original document is protected against edits. A compare would rewrite its content or its tracked changes.',
    };
  }
  // Before any work that scales with the documents, accepting their revisions included.
  const baseSize = storySize(original);
  const revisedSize = storySize(revised);
  if (
    baseSize.blocks + revisedSize.blocks > MAX_BLOCKS ||
    baseSize.text + revisedSize.text > MAX_TEXT_UNITS
  ) {
    return { ok: false, code: 'too-large', message: 'The documents are too large to compare.' };
  }
  const basePkg = acceptAll(original);
  const revisedPkg = acceptAll(revised);
  if (!basePkg) return unacceptable('original');
  if (!revisedPkg) return unacceptable('revised');
  const baseDoc = basePkg.parts.get(basePkg.mainDocumentPart);
  const revisedDoc = revisedPkg.parts.get(revisedPkg.mainDocumentPart);
  const baseBody = baseDoc && childNamed(baseDoc.root, 'body');
  const revisedBody = revisedDoc && childNamed(revisedDoc.root, 'body');
  if (!baseDoc || !baseBody) {
    return {
      ok: false,
      code: 'invalid-original',
      message: 'The original document has no main story.',
    };
  }
  if (!revisedDoc || !revisedBody) {
    return {
      ok: false,
      code: 'invalid-revised',
      message: 'The revised document has no main story.',
    };
  }

  // Before any revised content is serialized: it registers the revised list id map.
  const definitions = mergeDefinitions(basePkg, revisedPkg);
  const state = new CompareState();
  for (const [revisedId, outputId] of furnitureOutputIds(basePkg, revisedPkg))
    state.furnitureIds.set(revisedId, outputId);
  const scope = new NamespaceScope();
  const base = new SideContext('base', basePkg, basePkg.mainDocumentPart, scope);
  const next = new SideContext('revised', revisedPkg, revisedPkg.mainDocumentPart, scope);
  const ctx = new EmitContext(
    state,
    options.authorName ?? defaultAuthor(revisedPkg),
    options.removeDateAndTime ? undefined : revisionDate(options.date ?? new Date()),
    options.detectFormatChanges ?? true,
    base,
    next
  );
  const baseSect = childNamed(baseBody, 'sectPr');
  const revisedSect = childNamed(revisedBody, 'sectPr');
  const bodyShell = shellXml(scope, baseBody);
  const furnitureCtx = ctx;
  let furniture: ReturnType<typeof compareFurniture> = {
    outputs: [],
    extraRefs: '',
    unpaired: false,
  };
  const documentXml = storyXml(scope, baseDoc.root as ElementNode, () => {
    const content = compareContainer(unitsOf(baseBody, base), unitsOf(revisedBody, next), ctx);
    furniture = compareFurniture(basePkg, revisedPkg, furnitureCtx);
    const finalSect = sectPrXml(
      baseSect ?? null,
      revisedSect ?? null,
      ctx,
      furniture.extraRefs,
      true
    );
    return `${bodyShell.start}${content}${finalSect}${bodyShell.end}`;
  });

  const stories: StoryOutput[] = [
    { partName: baseDoc.name, contentType: baseDoc.contentType, xml: documentXml, isNew: false },
    ...furniture.outputs,
    ...definitions,
  ];
  for (const kind of ['footnote', 'endnote'] as const) {
    const notes = compareNotes(basePkg, revisedPkg, kind, ctx);
    if (notes.output) stories.push(notes.output);
    replaceNoteIds(stories, kind, notes.ids);
  }
  if (ctx.state.untracked > 0) {
    return {
      ok: false,
      code: 'unsupported-content',
      message:
        'The documents differ in block content that has no tracked-change form, such as an embedded file chunk.',
    };
  }
  if (furniture.unpaired) {
    return {
      ok: false,
      code: 'unsupported-content',
      message:
        'The documents differ in a header or footer of an earlier section that has no matching header or footer in the other document.',
    };
  }
  if (ctx.state.unrecordedProperties > 0) {
    return {
      ok: false,
      code: 'unsupported-content',
      message:
        'The revised document adds section or table settings, such as page borders, that a tracked change cannot restore on reject.',
    };
  }
  const assembled = assemblePackage(
    basePkg,
    revisedPkg,
    mergeComments(basePkg, revisedPkg, stories)
  );
  if (!assembled.ok) return { ok: false, code: 'unsupported-content', message: assembled.message };
  const check = selfCheck(assembled.pkg, basePkg, revisedPkg);
  if (!unchecked && (!check.accept || !check.reject) && check.guard) {
    return {
      ok: false,
      code: 'unsupported-content',
      message:
        'The documents differ inside a content control that is locked or bound to data. ' +
        'Changes there cannot be accepted or rejected.',
    };
  }
  if (!unchecked && (!check.accept || !check.reject)) {
    return {
      ok: false,
      code: 'unsupported-content',
      message: `The compare result does not reproduce both documents (${check.detail ?? ''}).`,
    };
  }
  return {
    ok: true,
    bytes: assembled.bytes,
    package: assembled.pkg,
    revisionCount: ctx.revisionCount,
  };
}

function shellXml(scope: NamespaceScope, node: ElementNode): { start: string; end: string } {
  const xml = scope.serialize({ ...node, children: [] } as ElementNode);
  const match = /^<([^\s/>]+)([^>]*?)\/?>/.exec(xml)!;
  return { start: `<${match[1]}${match[2]}>`, end: `</${match[1]}>` };
}

function replaceNoteIds(
  stories: StoryOutput[],
  kind: NoteKind,
  ids: ReadonlyMap<string, string>
): void {
  // One pass per story, whatever the number of notes. Runs without notes too, so a
  // dangling reference still loses its placeholder.
  for (let i = 0; i < stories.length; i++) {
    const xml = stories[i]!.xml.replace(NOTE_PLACEHOLDER, (whole, noteKind: string, id: string) =>
      // A reference to a note the revised document does not define keeps its own id.
      noteKind === kind
        ? (ids.get(fromPlaceholder(id)) ?? escapeAttribute(fromPlaceholder(id)))
        : whole
    );
    stories[i] = { ...stories[i]!, xml };
  }
}

const OFF_VALUES = new Set(['0', 'false', 'off']);
/** The protection kinds a compare refuses outright. */
const PROTECTED_EDITS = new Set(['readOnly', 'comments', 'forms']);

/**
 * Whether enforced document protection (`w:documentProtection`) forbids the compare. Read-only,
 * comments, and forms protection forbid content edits. Tracked-changes protection allows them
 * as tracked changes, which is all a compare writes, unless the original holds tracked changes
 * of its own: the compare would accept them.
 */
function protectedAgainstEdits(pkg: OoxmlPackage, formatChangesTracked: boolean): boolean {
  const settings = settingsPart(pkg);
  const protection =
    settings &&
    elementChildren(settings.root).find(
      (child) => child.localName === 'documentProtection' && child.namespaceUri === W_NS
    );
  if (!protection) return false;
  const edit = attributeOf(protection, 'edit', W_NS) ?? '';
  const enforcement = attributeOf(protection, 'enforcement', W_NS);
  if (enforcement === undefined || OFF_VALUES.has(enforcement)) return false;
  if (PROTECTED_EDITS.has(edit)) return true;
  if (edit !== 'trackedChanges') return false;
  // Without format detection, formatting and section differences are written untracked.
  return !formatChangesTracked || [...pkg.parts.values()].some((part) => hasRevision(part.root));
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** The settings part the main document's relationship names, as the editor reads it. */
const settingsPart = (pkg: OoxmlPackage) => relatedPart(pkg, 'settings');

function unacceptable(side: 'original' | 'revised'): ComparePackagesResult {
  return {
    ok: false,
    code: 'unsupported-content',
    message: `The ${side} document holds tracked changes that cannot be accepted, so its final state is unknown.`,
  };
}

/**
 * Accepts every revision in every story part, so both inputs compare in their final state, or
 * returns null when a part holds revisions that cannot be accepted.
 */
function acceptAll(pkg: OoxmlPackage): OoxmlPackage | null {
  let parts: Map<string, OoxmlPart> | null = null;
  for (const [name, part] of pkg.parts) {
    if (!hasRevision(part.root)) continue;
    const result = applyTreeOp(part, { op: 'acceptAllRevisions' });
    if (!result.ok) {
      // A part that only names revision elements without holding one has nothing to accept.
      if (result.reason === 'unknown-revision') continue;
      return null;
    }
    parts ??= new Map(pkg.parts);
    parts.set(name, result.part);
  }
  return parts ? { ...pkg, parts } : pkg;
}

const BLOCKS = new Set(['p', 'tbl', 'tr', 'tc', 'sdt', 'num', 'abstractNum', 'style']);
/**
 * What one run costs against the text limit: its per-run state weighs about as much as a dozen
 * characters, so many tiny runs cannot use more memory than plain text within the limit.
 */
const RUN_WEIGHT = 12;
/** Run content that the compare keeps as one character-like atom each; it counts as text. */
const OBJECT_ATOMS = new Set([
  'tab',
  'ptab',
  'br',
  'cr',
  'sym',
  'noBreakHyphen',
  'softHyphen',
  'fldChar',
  'drawing',
  'pict',
  'object',
  'footnoteReference',
  'endnoteReference',
  'commentReference',
]);

/** Blocks and text units in every story part of `pkg`, so no part escapes the bounds. */
function storySize(pkg: OoxmlPackage): { blocks: number; text: number } {
  const size = { blocks: 0, text: 0 };
  for (const part of pkg.parts.values()) {
    const root = part.root as ElementNode;
    const story = STORY_ROOTS.has(root.localName) && root.namespaceUri === W_NS;
    if (story || part.name === pkg.mainDocumentPart) countStory(root, size);
  }
  return size;
}

/**
 * Adds the paragraphs, tables, rows, cells, and content controls under `node` (text box content
 * included; properties do not count) and its text length to `size`.
 */
function countStory(node: ElementNode, size: { blocks: number; text: number }): void {
  const stack: OoxmlNode[] = [...node.children];
  while (stack.length > 0) {
    const child = stack.pop()!;
    if (child.kind === 'textValue') {
      size.text += child.value.length;
      continue;
    }
    if (BLOCKS.has(child.localName)) size.blocks++;
    else if (OBJECT_ATOMS.has(child.localName)) size.text++;
    else if (child.localName === 'r') size.text += RUN_WEIGHT;
    pushAll(stack, child.children);
  }
}

/** Minute precision, as revision timestamps are usually written. */
function revisionDate(date: Date): string {
  return `${date.toISOString().slice(0, 16)}:00Z`;
}

function defaultAuthor(pkg: OoxmlPackage): string {
  for (const part of pkg.parts.values()) {
    if (!part.contentType.endsWith('core-properties+xml')) continue;
    for (const name of ['lastModifiedBy', 'creator']) {
      const node = elementChildren(part.root).find((child) => child.localName === name);
      const text = node?.children
        .map((child) => (isElement(child) ? '' : child.value))
        .join('')
        .trim();
      if (text) return text;
    }
  }
  return 'Comparison';
}
