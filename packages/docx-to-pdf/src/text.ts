/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
import { PDFName, type PDFDocument, type PDFPage } from 'pdf-lib';
import type {
  FontBackedExportCapabilities,
  ExportAdmittedFontIdentity,
} from '@docx-editor.dev/core/export';
import {
  baselineShiftPtOf,
  noteSeparatorRuleBox,
  glyphSizeFactorOf,
  styleForFontSlot,
  TAB_LEADER_GLYPH,
  tabLeaderPattern,
  type SemanticSpanVisit,
} from '@docx-editor.dev/core/layout';
import { underlineGap } from './underline-gap.ts';
import { EmbeddedFace } from './fonts.ts';
import { color, number as n, rect, Work } from './context.ts';

/** Grid the reference puts painted baselines on. Paint only; layout never sees it. */
const PDF_PAINT_GRID_PT = 0.24;

export class TextWriter {
  readonly faces = new Map<string, EmbeddedFace>();
  private readonly refused = new Map<string, string>();
  constructor(
    readonly doc: PDFDocument,
    readonly session: FontBackedExportCapabilities,
    readonly work: Work,
    readonly showRevisionMarkup: boolean
  ) {}
  paint(visit: SemanticSpanVisit, page: PDFPage): string {
    const { span, line, storyOrigin, absoluteBox } = visit;
    if (span.style.hidden || !span.text) return '';
    if (span.noteSeparator) {
      const box = noteSeparatorRuleBox(span, line);
      return `${color(span.style.color)} rg ${rect(box, storyOrigin.x - visit.page.box.x, storyOrigin.y - visit.page.box.y, page.getHeight())} f`;
    }
    if (/^[\t\n\r\f]+$/.test(span.text)) return span.tabLeader ? this.leader(visit, page) : '';
    const report = (code: string, message: string): string => {
      this.work.report(code, message, visit.page.index);
      return '';
    };
    const shaped = this.session.shapeLaidOutText(span);
    if (!shaped)
      return report('unshaped-text', 'Core could not provide exact shaping for a visible span');
    if (shaped.run.glyphs.some((g) => g.id === 0))
      return report('missing-glyph', 'A visible span contains missing glyphs');
    const face = this.embeddedFace(shaped.font, visit, page);
    if (!face) return '';
    const style = styleForFontSlot(span.style, span.fontSlot);
    const factor = glyphSizeFactorOf(style);
    const size = (Math.max(1, Math.round(style.fontSizePt * 2)) / 2) * factor;
    const horizontal = style.horizontalScalePercent / 100;
    const scale = factor / shaped.fixedPointScale;
    const x = absoluteBox.x - visit.page.box.x + (span.glyphOffsetPt ?? 0);
    // Reference PDFs put every text baseline on a 0.24pt grid measured from the page top:
    // 109.44, 126.00, 141.84 and 168.72 are 456, 525, 591 and 703 units exactly. Snap the
    // PAINTED baseline only. Layout keeps its unrounded metrics, so flow and pagination
    // cannot move; rounding each line's HEIGHT instead accumulates and is badly wrong
    // (see .cache/pdf/claude-lineheight-grid/FINDING.md).
    const baselineFromTop =
      storyOrigin.y - visit.page.box.y + line.box.y + line.baseline - baselineShiftPtOf(style);
    const baseline =
      page.getHeight() - Math.round(baselineFromTop / PDF_PAINT_GRID_PT) * PDF_PAINT_GRID_PT;
    let foreground = style.color;
    const revisions = this.showRevisionMarkup ? (span.revisions ?? []) : [];
    const insert = revisions.some((r) => r.kind === 'insert' || r.kind === 'moveTo');
    const deleted = revisions.some((r) => r.kind === 'delete' || r.kind === 'moveFrom');
    if (insert) foreground = '008000';
    if (deleted) foreground = 'C00000';
    const out = [`${color(foreground)} rg`, 'BT', `/${face.name} ${n(size)} Tf`];
    if (style.textOutline)
      out.unshift(`q ${color(style.textOutline.color)} RG ${n(style.textOutline.widthPt)} w 2 Tr`);
    let extra = 0;
    let activeSize = size;
    let activeFace = face;
    let activeIdentity = shaped.font.identity;
    for (const cluster of [...shaped.run.clusters].sort((a, b) => a.glyphStart - b.glyphStart)) {
      const identity = shaped.fonts?.[cluster.fontSpan];
      if (identity && identity.identity !== activeIdentity) {
        const clusterFace = this.embeddedFace(identity, visit, page);
        if (!clusterFace) return '';
        activeFace = clusterFace;
        activeIdentity = identity.identity;
        out.push(`/${activeFace.name} ${n(activeSize)} Tf`);
      }
      const text = shaped.run.text.slice(cluster.textStart, cluster.textEnd);
      for (let i = cluster.glyphStart; i < cluster.glyphEnd; i++) {
        this.work.tick();
        const glyph = shaped.run.glyphs[i]!;
        const glyphSize = size * (glyph.drawScale ?? 1);
        if (glyphSize !== activeSize) {
          out.push(`/${activeFace.name} ${n(glyphSize)} Tf`);
          activeSize = glyphSize;
        }
        const code = activeFace.encode(glyph.id, i === cluster.glyphStart ? text : '');
        const gx = x + (glyph.originX + glyph.offsetX) * scale * horizontal + extra;
        const gy = baseline + (glyph.originY + glyph.offsetY) * scale;
        out.push(`${n(horizontal)} 0 0 1 ${n(gx)} ${n(gy)} Tm <${code}> Tj`);
      }
      extra +=
        text.length * style.characterSpacingPt +
        (text.match(/ /g)?.length ?? 0) * (style.shaping?.wordSpacingPt ?? 0);
    }
    out.push('ET');
    if (style.textOutline) out.push('Q');
    const metricScale = size / face.font.unitsPerEm;
    const lineRule = (
      y: number,
      thickness: number,
      c: string | null = foreground,
      width = absoluteBox.width
    ): void => {
      out.push(`${color(c)} rg ${n(x)} ${n(y - thickness / 2)} ${n(width)} ${n(thickness)} re f`);
    };
    if (style.underline || insert) {
      const variant = style.underline?.variant ?? 'single';
      const thickness = face.font.underlineThickness * metricScale;
      const position = baseline + face.font.underlinePosition * metricScale;
      if (!(thickness > 0) || !Number.isFinite(position))
        this.work.report(
          'underline-metrics',
          'Font has no valid underline metrics',
          visit.page.index
        );
      else {
        const c = style.underline?.color ?? foreground;
        const supported = [
          'single',
          'double',
          'thick',
          'dotted',
          'dash',
          'dashLong',
          'dotDash',
          'dotDotDash',
          'wave',
          'wavyDouble',
          'wavyHeavy',
          'dottedHeavy',
          'dashedHeavy',
          'dashLongHeavy',
          'dashDotHeavy',
          'dashDotDotHeavy',
          'words',
        ];
        if (!supported.includes(variant))
          this.work.report(
            'underline-style',
            `Unsupported underline: ${variant}`,
            visit.page.index
          );
        const heavy = variant === 'thick' || variant.endsWith('Heavy');
        const weight = thickness * (heavy ? 2 : 1);
        if (variant === 'wave' || variant.startsWith('wavy')) {
          const wave = (y: number): void => {
            const period = Math.max(2, weight * 6),
              amplitude = Math.max(0.6, weight);
            const path = [`${n(x)} ${n(y)} m`];
            for (let dx = 0; dx < absoluteBox.width; dx += period) {
              this.work.tick();
              const end = Math.min(dx + period, absoluteBox.width),
                length = end - dx;
              path.push(
                `${n(x + dx + length / 4)} ${n(y + amplitude)} ${n(x + dx + length / 4)} ${n(y + amplitude)} ${n(x + dx + length / 2)} ${n(y)} c`,
                `${n(x + dx + (3 * length) / 4)} ${n(y - amplitude)} ${n(x + dx + (3 * length) / 4)} ${n(y - amplitude)} ${n(x + end)} ${n(y)} c`
              );
            }
            out.push(`q ${color(c)} RG ${n(weight)} w ${path.join(' ')} S Q`);
          };
          wave(position);
          if (variant === 'wavyDouble') wave(position - weight * 4);
        } else if (variant.startsWith('dot') || variant.toLowerCase().includes('dash')) {
          const dotted = variant.startsWith('dotted');
          const pattern = dotted
            ? [weight, weight * 2]
            : variant.toLowerCase().includes('dotdot')
              ? [weight * 4, weight * 2, weight, weight * 2, weight, weight * 2]
              : variant.toLowerCase().includes('dot')
                ? [weight * 4, weight * 2, weight, weight * 2]
                : [weight * (variant.includes('Long') ? 8 : 4), weight * 2];
          out.push(
            `q ${color(c)} RG ${n(weight)} w [${pattern.map(n).join(' ')}] 0 d ${n(x)} ${n(position)} m ${n(x + absoluteBox.width)} ${n(position)} l S Q`
          );
        } else if (variant === 'words') {
          for (const cluster of shaped.run.clusters) {
            if (/^\s+$/.test(shaped.run.text.slice(cluster.textStart, cluster.textEnd))) continue;
            const glyph = shaped.run.glyphs[cluster.glyphStart]!;
            out.push(
              `${color(c)} rg ${n(x + glyph.originX * scale * horizontal)} ${n(position - thickness / 2)} ${n(cluster.advance * scale * horizontal)} ${n(thickness)} re f`
            );
          }
        } else {
          lineRule(
            position,
            weight,
            c,
            absoluteBox.width + (variant === 'single' ? underlineGap(visit) : 0)
          );
          if (variant === 'double') lineRule(position - thickness * 2, thickness, c);
        }
      }
    }
    if (style.strike || style.doubleStrike || deleted) {
      if (!face.strike || face.strike.thickness <= 0)
        this.work.report('strike-metrics', 'Font has no valid strike metrics', visit.page.index);
      else {
        const thickness = face.strike.thickness * metricScale;
        const position = baseline + face.strike.position * metricScale;
        lineRule(position, thickness);
        if (style.doubleStrike) lineRule(position + thickness * 2, thickness);
      }
    }
    return out.join('\n');
  }
  private embeddedFace(
    font: ExportAdmittedFontIdentity,
    visit: SemanticSpanVisit,
    page: PDFPage
  ): EmbeddedFace | undefined {
    const report = (code: string, message: string): undefined => {
      this.work.report(code, message, visit.page.index);
      return undefined;
    };
    let face = this.faces.get(font.identity);
    try {
      if (this.refused.has(font.identity))
        return report('font-embedding', this.refused.get(font.identity)!);
      if (!face) {
        const admitted = this.session.admittedFontFace(font.request);
        if (!admitted || admitted.identity !== font.identity)
          return report('font-identity', 'The shaped face does not match the admitted font');
        face = new EmbeddedFace(this.doc, admitted, this.faces.size + 1);
        this.faces.set(font.identity, face);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Font embedding refused';
      this.refused.set(font.identity, reason);
      return report('font-embedding', reason);
    }
    page.node.setFontDictionary(PDFName.of(face.name), face.ref);
    return face;
  }
  private leader(visit: SemanticSpanVisit, page: PDFPage): string {
    const glyph = TAB_LEADER_GLYPH.get(visit.span.tabLeader!);
    if (!glyph || visit.absoluteBox.width <= 0) return '';
    const advance = visit.span.tabLeaderAdvancePt;
    if (!advance || advance <= 0) {
      this.work.report(
        'tab-leader-metrics',
        'Tab leader has no measured advance',
        visit.page.index
      );
      return '';
    }
    const x = visit.absoluteBox.x - visit.page.box.x;
    const pattern = tabLeaderPattern(
      visit.textboxDepth ? visit.span.box.x : x,
      visit.absoluteBox.width,
      advance
    );
    const y =
      page.getHeight() -
      (visit.storyOrigin.y + visit.line.box.y - visit.page.box.y) -
      visit.line.box.height;
    const out = [
      `q ${n(x)} ${n(y)} ${n(visit.absoluteBox.width)} ${n(visit.line.box.height)} re W n`,
    ];
    for (let i = 0; i < pattern.count; i++) {
      this.work.tick();
      out.push(
        this.paint(
          {
            ...visit,
            absoluteBox: {
              ...visit.absoluteBox,
              x: visit.absoluteBox.x + pattern.offsetPt + i * advance,
              width: advance,
            },
            span: {
              ...visit.span,
              text: glyph,
              tabLeader: undefined,
              style: {
                ...visit.span.style,
                characterSpacingPt: 0,
                underline: null,
                bold: visit.span.tabLeader === 'heavy' || visit.span.style.bold,
              },
            },
          },
          page
        )
      );
    }
    out.push('Q');
    return out.join('\n');
  }
}
