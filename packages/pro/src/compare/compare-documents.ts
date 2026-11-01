/**
 * Document compare: the original with the revised document's differences as tracked changes.
 *
 * DOM-free and layout-free. Both inputs are compared in their accepted state; the output is
 * the original package with a new main story and any relationships and media the inserted
 * content needs.
 */
import {
  applyTreeOp,
  readOoxmlPackage,
  type OoxmlPackage,
  type OoxmlPart,
} from '@docx-editor.dev/core/store';
import type { CompareDocumentsOptions, CompareDocumentsResult } from './compare-types.ts';
import { EmitContext, sectPrXml } from './emit.ts';
import { assemblePackage } from './package-assemble.ts';
import { compareContainer } from './story-compare.ts';
import { SideContext, unitsOf } from './units.ts';
import {
  childNamed,
  elementChildren,
  isElement,
  NamespaceScope,
  type ElementNode,
} from './xml-fragments.ts';

/** Inputs larger than this many paragraph and table blocks are refused. */
const MAX_BLOCKS = 200_000;

export function compareDocuments(
  original: Uint8Array,
  revised: Uint8Array,
  options: CompareDocumentsOptions = {}
): CompareDocumentsResult {
  const baseRead = readOoxmlPackage(original);
  if (!baseRead.ok)
    return {
      ok: false,
      code: 'invalid-original',
      message: `The original document cannot be read (${baseRead.reason}).`,
    };
  const revisedRead = readOoxmlPackage(revised);
  if (!revisedRead.ok)
    return {
      ok: false,
      code: 'invalid-revised',
      message: `The revised document cannot be read (${revisedRead.reason}).`,
    };
  return comparePackages(baseRead.package, revisedRead.package, options);
}

export function comparePackages(
  original: OoxmlPackage,
  revised: OoxmlPackage,
  options: CompareDocumentsOptions = {}
): CompareDocumentsResult {
  const basePkg = acceptAll(original);
  const revisedPkg = acceptAll(revised);
  const baseDoc = basePkg.parts.get(basePkg.mainDocumentPart);
  const revisedDoc = revisedPkg.parts.get(revisedPkg.mainDocumentPart);
  const baseBody = baseDoc && childNamed(baseDoc.root, 'body');
  const revisedBody = revisedDoc && childNamed(revisedDoc.root, 'body');
  if (!baseDoc || !baseBody)
    return {
      ok: false,
      code: 'invalid-original',
      message: 'The original document has no main story.',
    };
  if (!revisedDoc || !revisedBody)
    return {
      ok: false,
      code: 'invalid-revised',
      message: 'The revised document has no main story.',
    };
  if (countBlocks(baseBody) + countBlocks(revisedBody) > MAX_BLOCKS) {
    return { ok: false, code: 'too-large', message: 'The documents are too large to compare.' };
  }

  const scope = new NamespaceScope();
  const base = new SideContext('base', basePkg, basePkg.mainDocumentPart, scope);
  const next = new SideContext('revised', revisedPkg, revisedPkg.mainDocumentPart, scope);
  const ctx = new EmitContext(
    options.authorName ?? defaultAuthor(revisedPkg),
    options.removeDateAndTime ? undefined : revisionDate(options.date ?? new Date()),
    options.detectFormatChanges ?? true,
    base,
    next
  );
  // The root shell first, so its prefixes win the namespace scope.
  const rootShell = scope
    .serialize({ ...baseDoc.root, children: [] } as ElementNode)
    .replace(/\/>$/, '>');
  const content = compareContainer(unitsOf(baseBody, base), unitsOf(revisedBody, next), ctx);
  const finalSect = sectPrXml(
    childNamed(baseBody, 'sectPr') ?? null,
    childNamed(revisedBody, 'sectPr') ?? null,
    ctx
  );
  const rootStart = rootShell.replace(/>$/, `${scope.declarations()}>`);
  const xml = `${rootStart}<w:body>${content}${finalSect}</w:body></w:document>`;

  const assembled = assemblePackage(basePkg, revisedPkg, xml);
  if (!assembled.ok) return { ok: false, code: 'unsupported-content', message: assembled.message };
  return { ok: true, bytes: assembled.bytes, revisionCount: ctx.revisionCount };
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

function hasRevision(node: ElementNode | OoxmlPart['root']): boolean {
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
