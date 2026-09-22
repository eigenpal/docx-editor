/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/docx-to-pdf/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Bounded, on-demand candidate layout evidence. No public API additions. */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import type {
  AnchoredDrawingRecord,
  BlockFragmentRecord,
  InlineDrawingRecord,
  LayoutBox,
  SemanticLayout,
} from '../../../core/src/layout/semantic-records.ts';
import { forEachPageStory } from '../../../core/src/layout/semantic-record-queries.ts';
import { openExportSession } from '../../src/open-session.ts';

const LIMIT = 8000;
const MAX_RECORDS = 100_000;
const SETTINGS = {
  displayMode: 'proposed' as const,
  useSystemFonts: false,
  glyphFallbacks: [
    'Noto Sans Symbols 2',
    'Noto Sans Math',
    'Noto Sans Arabic',
    'Noto Sans CJK JP',
    'Twemoji Mozilla',
    'Noto Emoji',
  ].map((family) => ({ family, weight: 400, style: 'normal' as const })),
};

type Origin = { x: number; y: number };
type TraceKind = 'all' | 'drawing' | 'table' | 'paragraph';
type TraceRecord = Record<string, unknown> & { bbox: number[]; nodeId: string };
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const round = (value: number) => Math.round(value * 1000) / 1000;
const bounded = (value: string | null | undefined) => value?.slice(0, 256) ?? null;
const bbox = (box: LayoutBox, origin: Origin) => [
  round(box.x + origin.x),
  round(box.y + origin.y),
  round(box.x + origin.x + box.width),
  round(box.y + origin.y + box.height),
];
const distance = (box: number[], y: number) => Math.max(box[1]! - y, y - box[3]!, 0);
const partOf = (nodeId: string) => {
  const split = nodeId.indexOf('#');
  return split > 0 && nodeId.startsWith('/') ? nodeId.slice(0, split) : null;
};

/** Exported only for eval calibration tests. All geometry uses page-local points. */
export function summarizeLayout(
  layout: SemanticLayout,
  pageNumber = 1,
  queryY = 0,
  kind: TraceKind = 'all'
) {
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isFinite(queryY))
    throw new Error('Expected a positive integer page and finite y coordinate');
  if (!['all', 'drawing', 'table', 'paragraph'].includes(kind))
    throw new Error('Expected kind drawing, table, or paragraph');
  const page = layout.pages[pageNumber - 1];
  if (!page) throw new Error(`Page ${pageNumber} does not exist (${layout.pages.length} pages)`);
  if (queryY < 0 || queryY > page.box.height)
    throw new Error('The y coordinate must be inside the selected page');
  const selected: TraceRecord[] = [];
  let visited = 0;
  let matched = 0;
  function offer(record: TraceRecord) {
    if (++visited > MAX_RECORDS) throw new Error('Trace exceeds record limit');
    if (
      kind !== 'all' &&
      (kind === 'drawing'
        ? record.kind !== 'inlineDrawing' && record.kind !== 'anchoredDrawing'
        : record.kind !== kind)
    )
      return;
    matched++;
    selected.push(record);
    selected.sort(
      (a, b) =>
        distance(a.bbox, queryY) - distance(b.bbox, queryY) ||
        Math.abs((a.bbox[1]! + a.bbox[3]!) / 2 - queryY) -
          Math.abs((b.bbox[1]! + b.bbox[3]!) / 2 - queryY) ||
        a.nodeId.localeCompare(b.nodeId)
    );
    selected.length = Math.min(3, selected.length);
  }
  function drawing(
    value: InlineDrawingRecord | AnchoredDrawingRecord,
    origin: Origin,
    story: string,
    approximate: boolean
  ) {
    offer({
      kind: value.kind,
      story,
      nodeId: value.drawingNodeId,
      partName: bounded(value.ownerPartName),
      paragraphId: bounded(value.paragraphId),
      bbox: bbox(value.paintBounds, origin),
      coordinatesApproximate: approximate,
      resourceState: value.resource.kind,
      hasVectorShape: Boolean(value.vectorShape),
      placeholderGraphicKind: value.placeholderGraphicKind,
      ...(value.kind === 'anchoredDrawing'
        ? {
            wrap: value.wrap,
            horizontalFrame: value.horizontalFrame,
            verticalFrame: value.verticalFrame,
            layoutFallback: value.layoutFallback,
            hasTextboxStory: Boolean(value.textboxStory),
          }
        : {}),
    });
  }
  function blocks(
    values: readonly BlockFragmentRecord[],
    origin: Origin,
    story: string,
    partName: string | null,
    approximate = false,
    depth = 0
  ) {
    if (depth > 32) throw new Error('Trace exceeds nesting limit');
    for (const block of values) {
      const nodeId = block.kind === 'paragraph' ? block.paragraphId : block.tableId;
      const common = {
        kind: block.kind,
        story,
        nodeId,
        partName: bounded(partName ?? partOf(nodeId)),
        fragmentIndex: block.fragmentIndex,
        bbox: bbox(block.box, origin),
        coordinatesApproximate: approximate,
      };
      if (block.kind === 'paragraph') {
        const lines = [...block.lines]
          .sort(
            (a, b) => distance(bbox(a.box, origin), queryY) - distance(bbox(b.box, origin), queryY)
          )
          .slice(0, 3);
        offer({
          ...common,
          resolved: {
            styleId: bounded(block.styleId),
            alignment: block.alignment,
            spacingPt: block.spacing,
            indentPt: block.indent,
            outOfFlow: Boolean(block.outOfFlow),
            clipped: Boolean(block.clipToBox),
          },
          lineCount: block.lines.length,
          lines: lines.map((line) => ({
            range: line.range,
            bbox: bbox(line.box, origin),
            baselineOffsetPt: round(line.baseline),
            leadingPt: round(line.leading),
            trailingSpacingPt: round(line.trailingSpacing ?? 0),
            manualBreakAfter: Boolean(line.manualBreakAfter),
            spanCount: line.spans.length,
            spans: line.spans.slice(0, 3).map((span) => ({
              range: span.range,
              bbox: bbox(span.box, origin),
              fontFamily: bounded(span.style.fontFamily),
              fontSizePt: span.style.fontSizePt,
              fontSlot: span.fontSlot ?? null,
              glyphOffsetPt: span.glyphOffsetPt ?? 0,
            })),
          })),
        });
        for (const line of block.lines)
          for (const value of line.drawings ?? []) drawing(value, origin, story, approximate);
      } else {
        offer({
          ...common,
          rowCount: block.rows.length,
          columnCount: Math.max(0, block.columnEdges.length - 1),
          columnEdgesPt: block.columnEdges.slice(0, 17),
          rows: [...block.rows]
            .sort(
              (a, b) =>
                distance(bbox(a.box, origin), queryY) - distance(bbox(b.box, origin), queryY)
            )
            .slice(0, 3)
            .map((row) => ({
              nodeId: row.id,
              rowIndex: row.rowIndex,
              bbox: bbox(row.box, origin),
              cellCount: row.cells.length,
              isHeaderRow: row.isHeaderRow,
              isHeaderRepeat: row.isHeaderRepeat,
              isContinuation: Boolean(row.isContinuation),
            })),
        });
        for (const row of block.rows)
          for (const cell of row.cells)
            if (!cell.paintInert && !cell.vMergeContinue)
              blocks(
                cell.blocks,
                origin,
                story,
                partName,
                approximate || Boolean(cell.textDirection),
                depth + 1
              );
      }
    }
  }
  forEachPageStory(page, (root) => {
    const origin = { x: root.origin.x - page.box.x, y: root.origin.y - page.box.y };
    const partName = 'partName' in root.host ? root.host.partName : null;
    blocks(root.host.fragments, origin, root.story, partName);
    if ('anchoredDrawings' in root.host)
      for (const value of root.host.anchoredDrawings ?? [])
        drawing(value, origin, root.story, false);
  });
  return {
    protocol: 1,
    status: 'traced',
    query: { page: pageNumber, yPt: queryY, kind },
    page: {
      number: pageNumber,
      count: layout.pages.length,
      bbox: [0, 0, page.box.width, page.box.height],
      contentBox: bbox(page.contentBox, { x: -page.box.x, y: -page.box.y }),
    },
    records: selected,
    recordsVisited: visited,
    recordsMatched: matched,
    selection: 'nearest-vertical-geometry',
    selectionMeaning: 'Nearby candidate records do not confirm the cause of a finding.',
    baselineCoordinateSpace: 'Offset from each line box top; all boxes use page-local points.',
    sourceMapping:
      'Candidate node identities are exact; correspondence with reference content is approximate.',
    untrusted: true,
    limits: {
      records: 3,
      linesPerRecord: 3,
      spansPerLine: 3,
      textIncluded: false,
      maxOutputCharacters: LIMIT,
      omitted: [
        'textbox interior records',
        'pagination decision history',
        'reference layout internals',
      ],
    },
  };
}

export async function traceDocument(source: Uint8Array, page = 1, y = 0, kind: TraceKind = 'all') {
  const signal = AbortSignal.timeout(60_000);
  const opened = await openExportSession(source, SETTINGS, signal);
  if (!opened.ok) throw new Error(`${opened.reason}: ${opened.detail ?? 'Document open failed'}`);
  try {
    const report = {
      ...summarizeLayout(await opened.session.layout(), page, y, kind),
      sourceSha256: hash(source),
      producer: {
        scriptSha256: hash(await readFile(import.meta.filename)),
        settingsSha256: hash(JSON.stringify(SETTINGS)),
        runtime: `bun-${process.versions.bun ?? 'unknown'}`,
        engineIdentity: 'Caller must attach its engine fingerprint.',
      },
      outputTruncated: false,
    };
    while (JSON.stringify(report).length > LIMIT && report.records.length) {
      report.records.pop();
      report.outputTruncated = true;
    }
    if (JSON.stringify(report).length > LIMIT) throw new Error('Trace exceeds output limit');
    return report;
  } finally {
    opened.session.dispose();
  }
}

if (import.meta.main) {
  const [input, output, ...flags] = process.argv.slice(2);
  try {
    if (!input || !output)
      throw new Error(
        'Expected input.docx output.json [--page N] [--y points] [--kind drawing|table|paragraph]'
      );
    let page = 1,
      y = 0;
    let kind: TraceKind = 'all';
    for (let i = 0; i < flags.length; i += 2) {
      if (flags[i] === '--page') page = Number(flags[i + 1]);
      else if (flags[i] === '--y') y = Number(flags[i + 1]);
      else if (flags[i] === '--kind') {
        const value = flags[i + 1];
        if (value !== 'drawing' && value !== 'table' && value !== 'paragraph')
          throw new Error('Expected kind drawing, table, or paragraph');
        kind = value;
      } else throw new Error(`Unknown flag: ${flags[i]}`);
    }
    const report = await traceDocument(new Uint8Array(await readFile(input)), page, y, kind);
    await writeFile(output, JSON.stringify(report));
    process.stdout.write(
      JSON.stringify({ protocol: 1, status: 'traced', records: report.records.length }) + '\n'
    );
  } catch (error) {
    process.stdout.write(
      JSON.stringify({
        protocol: 1,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      }) + '\n'
    );
    process.exitCode = 1;
  }
}
