/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  type PDFPage,
  type PDFObject,
  type PDFRef,
} from 'pdf-lib';
import type { ExportSemanticLayout } from '@docx-editor.dev/core/export';
import type { SemanticSpanVisit } from '@docx-editor.dev/core/layout';
import { pdfLiteralUri, Work } from './context.ts';

type Literal =
  | string
  | number
  | boolean
  | null
  | PDFObject
  | Literal[]
  | { [key: string]: Literal | undefined };
function add(
  doc: PDFDocument,
  page: PDFPage,
  dictionary: { [key: string]: Literal | undefined }
): PDFRef {
  const ref = doc.context.register(doc.context.obj(dictionary));
  page.node.addAnnot(ref);
  return ref;
}
export function linkAnnotation(
  doc: PDFDocument,
  page: PDFPage,
  visit: SemanticSpanVisit,
  destinations: Set<string>
): void {
  const link = visit.span.link;
  if (!link || !link.href) return;
  const b = visit.absoluteBox;
  const x = b.x - visit.page.box.x,
    y = page.getHeight() - (b.y - visit.page.box.y) - b.height;
  const base = {
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [x, y, x + b.width, y + b.height],
    Border: [0, 0, 0],
  };
  if (link.kind === 'internal' && link.anchor && destinations.has(link.anchor))
    add(doc, page, { ...base, Dest: PDFHexString.fromText(link.anchor) });
  // `URI` is a PDF byte string. Written as a UTF-16BE text string it decodes in pdf.js and
  // fails to open in a viewer that reads the bytes as they are. The scheme allowlist stays:
  // Core already sanitised the href, and this is the last check before it leaves the process.
  // `pdfLiteralUri` then escapes the bytes a literal string cannot carry bare, because
  // `PDFString.of` writes its value verbatim and a `)` in the href would end the string early.
  else if (link.kind === 'external' && /^(https?:|mailto:|tel:|ftp:)/i.test(link.href)) {
    const uri = pdfLiteralUri(link.href);
    if (uri !== null) add(doc, page, { ...base, A: { S: 'URI', URI: PDFString.of(uri) } });
  }
}
export function destinations(
  doc: PDFDocument,
  pages: PDFPage[],
  layout: ExportSemanticLayout
): Set<string> {
  const names: (PDFHexString | PDFArray)[] = [];
  const added = new Set<string>();
  for (const dest of [...(layout.destinations ?? [])].sort((a, b) =>
    PDFHexString.fromText(a.anchor.name).asString() <
    PDFHexString.fromText(b.anchor.name).asString()
      ? -1
      : 1
  )) {
    if (added.has(dest.anchor.name)) continue;
    const page = pages[dest.pageIndex],
      record = layout.pages[dest.pageIndex];
    if (!page || !record) continue;
    added.add(dest.anchor.name);
    names.push(
      PDFHexString.fromText(dest.anchor.name),
      doc.context.obj([
        page.ref,
        'XYZ',
        dest.pageStack.x - record.box.x,
        page.getHeight() - dest.pageStack.y + record.box.y,
        null,
      ])
    );
  }
  if (names.length)
    doc.catalog.set(PDFName.of('Names'), doc.context.obj({ Dests: { Names: names } }));
  return added;
}
export function comments(
  doc: PDFDocument,
  pages: PDFPage[],
  layout: ExportSemanticLayout,
  work: Work
): void {
  const primary = new Map<string, PDFRef>();
  const replies: { parent: string; ref: PDFRef }[] = [];
  let count = 0;
  for (const comment of layout.reviewArtifacts) {
    if (comment.kind !== 'comment') continue;
    const occurrences = comment.occurrences.filter((o) => o.geometry?.pageStack.length);
    const targets = occurrences.length ? occurrences : [null];
    for (const occurrence of targets) {
      work.tick();
      if (++count > 50_000) throw new RangeError('PDF annotation limit exceeded');
      const pageIndex = occurrence?.pageIndex ?? 0;
      const page = pages[pageIndex],
        record = layout.pages[pageIndex];
      if (!page || !record) continue;
      const boxes = occurrence?.geometry?.pageStack ?? [];
      const quads: number[] = [];
      for (const b of boxes) {
        const x = b.x - record.box.x,
          top = page.getHeight() - b.y + record.box.y;
        if (b.width > 0)
          quads.push(x, top, x + b.width, top, x, top - b.height, x + b.width, top - b.height);
      }
      const b = boxes[0];
      const x = b ? b.x - record.box.x : 12;
      const y = b ? page.getHeight() - b.y + record.box.y : page.getHeight() - 12;
      const xs = quads.filter((_, i) => i % 2 === 0),
        ys = quads.filter((_, i) => i % 2 === 1);
      // Avoid spreading attacker-sized coordinate lists into Math.min/max.
      const min = (a: number[]): number => a.reduce((v, n) => Math.min(v, n), Infinity);
      const max = (a: number[]): number => a.reduce((v, n) => Math.max(v, n), -Infinity);
      const rect = quads.length ? [min(xs), min(ys), max(xs), max(ys)] : [x, y - 18, x + 18, y];
      const ref = add(doc, page, {
        Type: 'Annot',
        Subtype: quads.length ? 'Highlight' : 'Text',
        Rect: rect,
        ...(quads.length ? { QuadPoints: quads } : { Name: 'Comment' }),
        T: PDFHexString.fromText(comment.author),
        Contents: PDFHexString.fromText(
          `${occurrence ? '' : '[Unanchored comment]\n'}${comment.text}`
        ),
        NM: PDFHexString.fromText(`comment-${comment.id}-${count}`),
        C: [1, 0.85, 0.2],
        CA: 0.25,
        ...(comment.date && Number.isFinite(Date.parse(comment.date))
          ? {
              M: PDFHexString.fromText(
                `D:${new Date(comment.date).toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z`
              ),
            }
          : {}),
        ...(comment.resolved ? { StateModel: 'Review', State: 'Completed' } : {}),
        F: 4,
      });
      if (!primary.has(comment.id)) primary.set(comment.id, ref);
      if (comment.parentId) replies.push({ parent: comment.parentId, ref });
      if (!occurrence)
        work.report(
          'unanchored-comment',
          'A comment without visible geometry is preserved as a first-page note',
          0,
          'information'
        );
    }
  }
  for (const reply of replies) {
    const parent = primary.get(reply.parent);
    if (parent) {
      const dictionary = doc.context.lookup(reply.ref);
      if (dictionary instanceof PDFDict) {
        dictionary.set(PDFName.of('IRT'), parent);
        dictionary.set(PDFName.of('RT'), PDFName.of('R'));
      }
    }
  }
}
