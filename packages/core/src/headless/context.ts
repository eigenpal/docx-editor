import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import type { DocxPackage } from './types.ts';
import type { NoteParagraphIds, RevisionIndex } from './revision-bridge.ts';

/** Opaque canonical state retained across parse/repack — not part of the legacy projection. */
export interface HeadlessCanonicalContext {
  readonly package: OoxmlPackage;
  /** Legacy projection snapshot at parse time — repack diffs against this, never rebuilds from scratch. */
  readonly baseline: DocxPackage;
  /** Document-wide paragraph index → canonical tree paragraph node id (mirrors agents traversal). */
  readonly paragraphIds: readonly string[];
  /** Canonical revision wrappers keyed with stable synthetic legacy ids. */
  readonly revisionIndex: RevisionIndex;
  /** Note-local paragraph node ids for footnote/endnote repack. */
  readonly noteParagraphIds: NoteParagraphIds;
}

const CONTEXT = new WeakMap<object, HeadlessCanonicalContext>();

export function attachHeadlessContext(doc: object, ctx: HeadlessCanonicalContext): void {
  CONTEXT.set(doc, ctx);
}

export function headlessContextOf(doc: object): HeadlessCanonicalContext | undefined {
  return CONTEXT.get(doc);
}

export function cloneHeadlessContext(ctx: HeadlessCanonicalContext): HeadlessCanonicalContext {
  return Object.freeze({
    package: ctx.package,
    baseline: structuredClone(ctx.baseline),
    paragraphIds: [...ctx.paragraphIds],
    revisionIndex: ctx.revisionIndex,
    noteParagraphIds: ctx.noteParagraphIds,
  });
}
