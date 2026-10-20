/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * The lines the exporter lays out, read straight from Core's layout records.
 *
 * Positions come from the records, never from our own PDF: a text extractor reassembles the
 * per-glyph text matrices the writer emits into words of its own choosing, and the result
 * is not what layout said. Everything here is in points from the page's top-left corner,
 * with `unitsOf` for the 0.24pt device grid the reference renders on.
 */
import { PDFDocument } from 'pdf-lib';
import { forEachSemanticSpan } from '@docx-editor.dev/core/layout';
import { baselineShiftPtOf, styleForFontSlot } from '@docx-editor.dev/core/layout';
import { EmbeddedFace } from '../../src/fonts.ts';
import { paintedBaselineFromTop } from '../../src/text.ts';
import { openExportSession, type SessionOptions } from '../../src/open-session.ts';

export const GRID_PT = 0.24;
export const unitsOf = (points: number): number => points / GRID_PT;

export interface LaidOutSpan {
  readonly text: string;
  readonly x: number;
  readonly width: number;
  readonly family: string | null;
  readonly sizePt: number;
  readonly raisePt: number;
  /** The face that shaped the span, when the session could shape it exactly. */
  readonly face: string | null;
}

export interface LaidOutLine {
  readonly page: number;
  readonly story: string;
  readonly paragraphId: string;
  readonly lineIndex: number;
  readonly text: string;
  readonly top: number;
  /** Layout's baseline, before the writer's device-grid snap. */
  readonly baseline: number;
  /** The baseline the PDF carries: layout's, put through the writer's grid rules. */
  readonly painted: number;
  readonly height: number;
  readonly leading: number;
  readonly x: number;
  readonly right: number;
  readonly spans: readonly LaidOutSpan[];
}

export interface LaidOutDocument {
  readonly pageCount: number;
  readonly pageHeights: readonly number[];
  readonly lines: readonly LaidOutLine[];
}

/** Lay a document out as the exporter would and return its lines in reading order per page. */
export async function collectLines(
  source: Uint8Array,
  options: SessionOptions = {}
): Promise<LaidOutDocument> {
  const opened = await openExportSession(source, options);
  if (!opened.ok) throw new Error(`Cannot open document: ${opened.reason}`);
  try {
    const layout = await opened.session.layout();
    // The writer's own face objects, so the painted baseline uses the metrics it uses.
    const doc = await PDFDocument.create({ updateMetadata: false });
    const faces = new Map<string, EmbeddedFace | null>();
    const faceFor = (identity: {
      identity: string;
      request: Parameters<typeof opened.session.admittedFontFace>[0];
    }) => {
      let face = faces.get(identity.identity);
      if (face === undefined) {
        try {
          const admitted = opened.session.admittedFontFace(identity.request);
          face = admitted ? new EmbeddedFace(doc, admitted, faces.size + 1) : null;
        } catch {
          face = null;
        }
        faces.set(identity.identity, face);
      }
      return face;
    };
    const groups = new Map<object, { line: LaidOutLine; spans: LaidOutSpan[] }>();
    forEachSemanticSpan(layout, (visit) => {
      const { span, line, page, storyOrigin } = visit;
      if (span.style.hidden) return;
      const style = styleForFontSlot(span.style, span.fontSlot);
      const shaped = opened.session.shapeLaidOutText(span);
      let group = groups.get(line);
      if (!group) {
        const top = storyOrigin.y + line.box.y - page.box.y;
        const face = shaped ? faceFor(shaped.font) : null;
        group = {
          line: {
            page: page.index + 1,
            story: visit.story,
            paragraphId: visit.paragraphId,
            lineIndex: visit.paragraph.lines.indexOf(line),
            text: '',
            top,
            baseline: top + line.baseline,
            painted: face
              ? paintedBaselineFromTop(top, line, face, visit.paragraph)
              : top + line.baseline,
            height: line.box.height,
            leading: line.leading ?? 0,
            x: Infinity,
            right: -Infinity,
            spans: [],
          },
          spans: [],
        };
        groups.set(line, group);
      }
      group.spans.push({
        text: span.text,
        x: visit.absoluteBox.x - page.box.x,
        width: visit.absoluteBox.width,
        family: style.fontFamily,
        sizePt: style.fontSizePt,
        raisePt: baselineShiftPtOf(style),
        face: shaped ? shaped.font.request.family : null,
      });
    });
    const lines: LaidOutLine[] = [];
    for (const { line, spans } of groups.values()) {
      spans.sort((a, b) => a.x - b.x);
      const visible = spans.filter((s) => s.text.length > 0);
      if (visible.length === 0) continue;
      lines.push({
        ...line,
        text: visible.map((s) => s.text).join(''),
        x: Math.min(...visible.map((s) => s.x)),
        right: Math.max(...visible.map((s) => s.x + s.width)),
        spans: visible,
      });
    }
    lines.sort((a, b) => a.page - b.page || a.baseline - b.baseline || a.x - b.x);
    return {
      pageCount: layout.pages.length,
      pageHeights: layout.pages.map((page) => page.box.height),
      lines,
    };
  } finally {
    opened.session.dispose();
  }
}

/** Whitespace-insensitive text for pairing lines between two renderers. */
export function normalizeLineText(text: string): string {
  return text.replace(/[­​﻿]/g, '').replace(/\s+/g, ' ').trim();
}
