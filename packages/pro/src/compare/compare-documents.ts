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
import { CompareState, EmitContext, notePlaceholder, sectPrXml, type NoteKind } from './emit.ts';
import { assemblePackage } from './package-assemble.ts';
import { mergeComments } from './comments.ts';
import { selfCheck } from './self-check.ts';
import { compareFurniture, compareNotes, storyXml, type StoryOutput } from './stories.ts';
import { compareContainer } from './story-compare.ts';
import { SideContext, unitsOf } from './units.ts';
import {
  childNamed,
  elementChildren,
  isElement,
  NamespaceScope,
  type ElementNode,
} from './xml-fragments.ts';

/** Inputs larger than this many blocks (paragraphs, tables, rows, cells) are refused. */
const MAX_BLOCKS = 200_000;

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
  const basePkg = acceptAll(original);
  const revisedPkg = acceptAll(revised);
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
  if (countBlocks(baseBody) + countBlocks(revisedBody) > MAX_BLOCKS) {
    return { ok: false, code: 'too-large', message: 'The documents are too large to compare.' };
  }

  const state = new CompareState();
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
  let furniture: ReturnType<typeof compareFurniture> = { outputs: [], extraRefs: '' };
  const documentXml = storyXml(scope, baseDoc.root as ElementNode, () => {
    const content = compareContainer(unitsOf(baseBody, base), unitsOf(revisedBody, next), ctx);
    furniture = compareFurniture(basePkg, revisedPkg, baseSect, revisedSect, furnitureCtx);
    const finalSect = sectPrXml(baseSect ?? null, revisedSect ?? null, ctx, furniture.extraRefs);
    return `${bodyShell.start}${content}${finalSect}${bodyShell.end}`;
  });

  const stories: StoryOutput[] = [
    { partName: baseDoc.name, contentType: baseDoc.contentType, xml: documentXml, isNew: false },
    ...furniture.outputs,
  ];
  for (const kind of ['footnote', 'endnote'] as const) {
    const notes = compareNotes(basePkg, revisedPkg, kind, ctx);
    if (notes.output) stories.push(notes.output);
    replaceNoteIds(stories, kind, notes.ids);
  }
  const assembled = assemblePackage(
    basePkg,
    revisedPkg,
    mergeComments(basePkg, revisedPkg, stories)
  );
  if (!assembled.ok) return { ok: false, code: 'unsupported-content', message: assembled.message };
  const check = selfCheck(assembled.pkg, basePkg, revisedPkg);
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
  if (ids.size === 0) return;
  for (let i = 0; i < stories.length; i++) {
    let xml = stories[i]!.xml;
    for (const [revisedId, id] of ids) xml = xml.split(notePlaceholder(kind, revisedId)).join(id);
    stories[i] = { ...stories[i]!, xml };
  }
}

/** Accepts every revision in every story part, so both inputs compare in their final state. */
function acceptAll(pkg: OoxmlPackage): OoxmlPackage {
  let parts: Map<string, OoxmlPart> | null = null;
  for (const [name, part] of pkg.parts) {
    if (!hasRevision(part.root)) continue;
    const result = applyTreeOp(part, { op: 'acceptAllRevisions' });
    if (!result.ok) continue;
    parts ??= new Map(pkg.parts);
    parts.set(name, result.part);
  }
  return parts ? { ...pkg, parts } : pkg;
}

const REVISION_NAMES = new Set([
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'rPrChange',
  'pPrChange',
  'sectPrChange',
  'tblPrChange',
  'trPrChange',
  'tcPrChange',
  'tblGridChange',
  'numberingChange',
  'cellIns',
  'cellDel',
]);

function hasRevision(node: OoxmlPart['root'] | ElementNode): boolean {
  if (!isElement(node)) return false;
  if (REVISION_NAMES.has(node.localName)) return true;
  return node.children.some((child) => isElement(child) && hasRevision(child));
}

function countBlocks(node: ElementNode): number {
  let count = 0;
  for (const child of elementChildren(node)) {
    if (child.localName === 'p') count++;
    else count += 1 + countBlocks(child);
  }
  return count;
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
