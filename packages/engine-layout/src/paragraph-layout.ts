import {
  createStyleResolver,
  type PackageModel,
  type ParagraphRecord,
  type RunProps,
} from '@docx-editor.dev/engine-core';
import { FontResolutionError, type FontRequest, type ResolvedFont } from './font-resource.ts';
import type { CaretEdgeItem, DisplayItem, TextItem, VisualLineIdentity } from './display-item.ts';
import { segmentGraphemes, utf16OffsetToGrapheme } from './grapheme.ts';
import { LineTracker } from './line-tracker.ts';
import {
  createShapingEnvironment,
  shapingEnvironmentFingerprint,
  shapingEnvironmentFingerprintInputs,
  type ShapeInput,
  type ShapedRun,
  type TextDirection,
} from './shaped-run.ts';
import type { LayoutShapingOptions } from './metrics.ts';
import { bidiAlgorithm, type BidiEmbeddingLevels } from './bidi.ts';
import { itemizeScriptFontSlots, type FontSlot } from './script-itemization.ts';

export interface ParagraphLayoutSink {
  push(item: DisplayItem): void;
  currentPageIndex(): number;
}

interface ResolvedSpan {
  readonly from: number;
  readonly to: number;
  readonly text: string;
  readonly props: RunProps;
  readonly request: FontRequest;
  readonly font: ResolvedFont;
  readonly direction: TextDirection;
  readonly bidiLevel: number;
  readonly script: string;
}

interface ShapedSlice {
  readonly from: number;
  readonly to: number;
  readonly span: ResolvedSpan;
  readonly run: ShapedRun;
  readonly input: ShapeInput;
  readonly width: number;
  readonly height: number;
}

const DEFAULT_TEXT_COLOR = '000000';

const shapingFingerprint = (
  input: ShapeInput,
  run: ShapedRun,
  color: string,
  producer: LayoutShapingOptions['operation']
): string => {
  return JSON.stringify([
    input.fontSizeHalfPoints,
    input.bidiLevel,
    color,
    shapingEnvironmentFingerprint(input.environment),
    run.fontSpans.map((span) => ({
      glyphStart: span.glyphStart,
      glyphEnd: span.glyphEnd,
      fallbackIndex: span.fallbackIndex,
      font: {
        identity: span.font.identity,
        id: span.font.id,
        family: span.font.family,
        request: span.font.request,
        hash: span.font.hash,
        faceIndex: span.font.faceIndex,
        byteLength: span.font.byteLength,
        substitution: span.font.substitution,
      },
    })),
    producer.configEpoch,
    producer.extensionFingerprint,
    producer.shapingHash,
    producer.producerVersion,
  ]);
};

const glyphClusters = (text: string, run: ShapedRun) => {
  const segments = segmentGraphemes(text);
  const graphemeAtUtf16 = new Int32Array(text.length + 1);
  segments.forEach((segment, index) => {
    for (let offset = segment.utf16From; offset < segment.utf16To; offset += 1) {
      graphemeAtUtf16[offset] = index;
    }
  });
  graphemeAtUtf16[text.length] = segments.length;
  return Object.freeze(
    run.clusters.map((cluster) =>
      Object.freeze({
        utf16From: cluster.textStart,
        utf16To: cluster.textEnd,
        graphemeFrom: graphemeAtUtf16[cluster.textStart]!,
        graphemeTo: graphemeAtUtf16[cluster.textEnd]!,
        glyphFrom: cluster.glyphStart,
        glyphTo: cluster.glyphEnd,
        advance: cluster.advance,
        caretEdges: cluster.caretEdges,
        fontSpan: cluster.fontSpan,
      })
    )
  );
};

interface Atom {
  readonly from: number;
  readonly to: number;
  readonly width: number;
  readonly whitespace: boolean;
}

const paragraphText = (paragraph: ParagraphRecord): string =>
  paragraph.runs.map((run) => run.text).join('');

const familyFor = (props: RunProps, slot: FontSlot, fallback: string): string => {
  if (slot === 'cs') return props.fonts?.cs ?? props.fonts?.hAnsi ?? props.fonts?.ascii ?? fallback;
  if (slot === 'eastAsia')
    return props.fonts?.eastAsia ?? props.fonts?.hAnsi ?? props.fonts?.ascii ?? fallback;
  if (slot === 'hAnsi') return props.fonts?.hAnsi ?? props.fonts?.ascii ?? fallback;
  return props.fonts?.ascii ?? props.fonts?.hAnsi ?? fallback;
};

const spanKey = (span: Omit<ResolvedSpan, 'from' | 'to' | 'text' | 'font'>): string =>
  JSON.stringify([
    span.request.family,
    span.request.weight,
    span.request.style,
    span.props.sizeHalfPoints,
    span.props.color,
    span.direction,
    span.bidiLevel,
    span.script,
  ]);

function resolveSpans(
  model: PackageModel,
  paragraph: ParagraphRecord,
  shaping: LayoutShapingOptions,
  embedding: BidiEmbeddingLevels
): readonly ResolvedSpan[] {
  const resolver = createStyleResolver(model);
  const spans: ResolvedSpan[] = [];
  const text = paragraphText(paragraph);
  const scriptItems = itemizeScriptFontSlots(text, 0, embedding);
  let offset = 0;
  let scriptIndex = 0;
  for (const run of paragraph.runs) {
    if (run.text.length === 0) continue;
    const runFrom = offset;
    const runTo = runFrom + run.text.length;
    const resolvedProps = resolver.runProps(paragraph, run);
    const props: RunProps = Object.freeze({
      ...resolvedProps,
      sizeHalfPoints: resolvedProps.sizeHalfPoints ?? shaping.defaultFont.sizeHalfPoints,
      color: resolvedProps.color ?? DEFAULT_TEXT_COLOR,
      bold: resolvedProps.bold === true,
      italic: resolvedProps.italic === true,
    });
    while (scriptIndex < scriptItems.length && scriptItems[scriptIndex]!.to <= runFrom) {
      scriptIndex += 1;
    }
    for (let index = scriptIndex; index < scriptItems.length; index += 1) {
      const item = scriptItems[index]!;
      if (item.from >= runTo) break;
      const from = Math.max(runFrom, item.from);
      const to = Math.min(runTo, item.to);
      if (to <= from) continue;
      const { bidiLevel, direction, script } = item;
      const segmentText = text.slice(from, to);
      const request: FontRequest = {
        family: familyFor(props, item.slot, shaping.defaultFont.family),
        weight: props.bold === true ? 700 : 400,
        style: props.italic === true ? 'italic' : 'normal',
      };
      const unresolved = {
        props,
        request,
        direction,
        bidiLevel,
        script,
      };
      const previous = spans.at(-1);
      if (previous && previous.to === from && spanKey(previous) === spanKey(unresolved)) {
        spans[spans.length - 1] = {
          ...previous,
          to,
          text: previous.text + segmentText,
        };
      } else {
        const font = shaping.fonts.resolve(request);
        if (font instanceof FontResolutionError) throw font;
        spans.push({
          from,
          to,
          text: segmentText,
          props,
          request,
          font,
          direction,
          bidiLevel,
          script,
        });
      }
    }
    while (scriptIndex < scriptItems.length && scriptItems[scriptIndex]!.to <= runTo) {
      scriptIndex += 1;
    }
    offset += run.text.length;
  }
  return spans;
}

const shapeInput = (
  span: ResolvedSpan,
  text: string,
  shaping: LayoutShapingOptions
): ShapeInput => ({
  text,
  fontSizeHalfPoints: span.props.sizeHalfPoints ?? shaping.defaultFont.sizeHalfPoints,
  bidiLevel: span.bidiLevel,
  environment: createShapingEnvironment({
    ...shaping.environment,
    font: span.font,
    direction: span.direction,
    script: span.script,
    fallbackOrder: [],
  }),
});

const runWidth = (run: ShapedRun): number =>
  run.glyphs.reduce((width, glyph) => width + glyph.advanceX, 0);

const runHeight = (run: ShapedRun): number =>
  run.metrics.ascent + run.metrics.descent + run.metrics.lineGap;

export function defaultShapedLineHeight(shaping: LayoutShapingOptions): number {
  const request: FontRequest = {
    family: shaping.defaultFont.family,
    weight: 400,
    style: 'normal',
  };
  const font = shaping.fonts.resolve(request);
  if (font instanceof FontResolutionError) throw font;
  const span: ResolvedSpan = {
    from: 0,
    to: 1,
    text: ' ',
    props: {},
    request,
    font,
    direction: 'ltr',
    bidiLevel: 0,
    script: 'Latn',
  };
  return Math.max(1, runHeight(shaping.shaper.shape(shapeInput(span, ' ', shaping))));
}

function shapeSlice(
  span: ResolvedSpan,
  from: number,
  to: number,
  shaping: LayoutShapingOptions
): ShapedSlice {
  const text = span.text.slice(from - span.from, to - span.from);
  const input = shapeInput(span, text, shaping);
  const run = shaping.shaper.shape(input);
  return {
    from,
    to,
    span,
    run,
    input,
    width: runWidth(run),
    height: runHeight(run),
  };
}

function shapeRange(
  spans: readonly ResolvedSpan[],
  from: number,
  to: number,
  shaping: LayoutShapingOptions
): readonly ShapedSlice[] {
  const slices: ShapedSlice[] = [];
  for (const span of spans) {
    const sliceFrom = Math.max(from, span.from);
    const sliceTo = Math.min(to, span.to);
    if (sliceTo > sliceFrom) slices.push(shapeSlice(span, sliceFrom, sliceTo, shaping));
  }
  return slices;
}

function splitTabsForPaint(
  slices: readonly ShapedSlice[],
  shaping: LayoutShapingOptions
): readonly ShapedSlice[] {
  const out: ShapedSlice[] = [];
  for (const slice of slices) {
    let start = 0;
    while (start < slice.run.text.length) {
      const tab = slice.run.text[start] === '\t';
      let end = start + 1;
      while (end < slice.run.text.length && (slice.run.text[end] === '\t') === tab) end += 1;
      out.push(shapeSlice(slice.span, slice.from + start, slice.from + end, shaping));
      start = end;
    }
  }
  return out;
}

function visualOrder(
  slices: readonly ShapedSlice[],
  text: string,
  embedding: BidiEmbeddingLevels,
  from: number,
  to: number
): readonly ShapedSlice[] {
  if (slices.length < 2 || to <= from) return slices;
  const logicalAtVisual = Array.from({ length: to - from }, (_, index) => from + index);
  for (const [flipFrom, flipTo] of bidiAlgorithm.getReorderSegments(
    text,
    embedding,
    from,
    to - 1
  )) {
    const localFrom = Math.max(0, flipFrom - from);
    const localTo = Math.min(logicalAtVisual.length - 1, flipTo - from);
    if (localTo < localFrom) continue;
    const reversed = logicalAtVisual.slice(localFrom, localTo + 1).reverse();
    logicalAtVisual.splice(localFrom, reversed.length, ...reversed);
  }
  const visualPosition = new Map<number, number>();
  logicalAtVisual.forEach((logical, visual) => visualPosition.set(logical, visual));
  const firstVisualPosition = (slice: ShapedSlice): number => {
    let first = Number.POSITIVE_INFINITY;
    for (let logical = slice.from; logical < slice.to; logical += 1) {
      const visual = visualPosition.get(logical);
      if (visual !== undefined && visual < first) first = visual;
    }
    return first;
  };
  return [...slices].sort((left, right) => {
    return firstVisualPosition(left) - firstVisualPosition(right);
  });
}

function legalBoundaries(text: string, slices: readonly ShapedSlice[]): readonly number[] {
  const grapheme = new Set<number>([0, text.length]);
  for (const segment of segmentGraphemes(text)) {
    grapheme.add(segment.utf16From);
    grapheme.add(segment.utf16To);
  }
  const cluster = new Set<number>([0, text.length]);
  for (const slice of slices) {
    for (const shapedCluster of slice.run.clusters) {
      cluster.add(slice.from + shapedCluster.textStart);
      cluster.add(slice.from + shapedCluster.textEnd);
    }
  }
  return [...grapheme].filter((offset) => cluster.has(offset)).sort((left, right) => left - right);
}

function atomsFor(
  text: string,
  slices: readonly ShapedSlice[],
  boundaries: readonly number[]
): readonly Atom[] {
  const widths = new Array<number>(Math.max(0, boundaries.length - 1)).fill(0);
  let atomIndex = 0;
  for (const slice of slices) {
    const clusters = [...slice.run.clusters].sort(
      (left, right) => left.textStart - right.textStart
    );
    for (const cluster of clusters) {
      const clusterFrom = slice.from + cluster.textStart;
      const clusterTo = slice.from + cluster.textEnd;
      while (atomIndex < widths.length && boundaries[atomIndex + 1]! <= clusterFrom) {
        atomIndex += 1;
      }
      if (
        atomIndex < widths.length &&
        boundaries[atomIndex]! <= clusterFrom &&
        boundaries[atomIndex + 1]! >= clusterTo
      ) {
        widths[atomIndex] += cluster.advance;
      }
    }
  }
  const atoms: Atom[] = [];
  for (let index = 1; index < boundaries.length; index += 1) {
    const from = boundaries[index - 1]!;
    const to = boundaries[index]!;
    atoms.push({
      from,
      to,
      width: widths[index - 1]!,
      whitespace: /^\s/u.test(text.slice(from, to)),
    });
  }
  return atoms;
}

function lineRanges(
  atoms: readonly Atom[],
  spans: readonly ResolvedSpan[],
  shaping: LayoutShapingOptions,
  availableWidth: number,
  degenerateBox: boolean
): readonly (readonly [number, number])[] {
  if (atoms.length === 0) return [[0, 0]];
  const ranges: (readonly [number, number])[] = [];
  let atomStart = 0;
  while (atomStart < atoms.length) {
    let width = 0;
    let atomEnd = atomStart;
    let preferredEnd = -1;
    while (atomEnd < atoms.length) {
      const next = atoms[atomEnd]!;
      if (availableWidth > 0 && width + next.width > availableWidth && atomEnd > atomStart) {
        if (next.whitespace) {
          width += next.width;
          atomEnd += 1;
          preferredEnd = atomEnd;
        }
        break;
      }
      width += next.width;
      atomEnd += 1;
      if (next.whitespace) preferredEnd = atomEnd;
    }
    const usedPreferredBreak = atomEnd < atoms.length && preferredEnd > atomStart;
    if (usedPreferredBreak) atomEnd = preferredEnd;
    if (degenerateBox && preferredEnd === -1) {
      while (atomEnd < atoms.length) {
        const next = atoms[atomEnd]!;
        atomEnd += 1;
        if (next.whitespace) break;
      }
    }
    if (atomEnd === atomStart) atomEnd += 1;

    const from = atoms[atomStart]!.from;
    let to = atoms[atomEnd - 1]!.to;
    let reshaped = shapeRange(spans, from, to, shaping);
    let reshapedWidth = reshaped.reduce((sum, slice) => sum + slice.width, 0);
    while (
      !degenerateBox &&
      availableWidth > 0 &&
      reshapedWidth > availableWidth &&
      atomEnd - atomStart > 1 &&
      !atoms[atomEnd - 1]!.whitespace
    ) {
      atomEnd -= 1;
      to = atoms[atomEnd - 1]!.to;
      reshaped = shapeRange(spans, from, to, shaping);
      reshapedWidth = reshaped.reduce((sum, slice) => sum + slice.width, 0);
    }
    if (!degenerateBox && availableWidth > 0) {
      for (let candidateEnd = atomEnd + 1; candidateEnd <= atoms.length; candidateEnd += 1) {
        if (
          usedPreferredBreak &&
          candidateEnd < atoms.length &&
          !atoms[candidateEnd - 1]!.whitespace
        ) {
          continue;
        }
        const candidateTo = atoms[candidateEnd - 1]!.to;
        const candidateWidth = shapeRange(spans, from, candidateTo, shaping).reduce(
          (sum, slice) => sum + slice.width,
          0
        );
        if (candidateWidth > availableWidth) break;
        atomEnd = candidateEnd;
        to = candidateTo;
      }
    }
    ranges.push([from, to]);
    atomStart = atomEnd;
  }
  return ranges;
}

function clusterEdges(slice: ShapedSlice): readonly { offset: number; x: number }[] {
  const edges = new Map<number, number>();
  if (slice.run.direction === 'ltr') {
    let x = 0;
    edges.set(slice.from, 0);
    for (const cluster of slice.run.clusters) {
      x += cluster.advance;
      edges.set(slice.from + cluster.textEnd, x);
    }
  } else {
    let x = 0;
    edges.set(slice.to, 0);
    for (const cluster of slice.run.clusters) {
      x += cluster.advance;
      edges.set(slice.from + cluster.textStart, x);
    }
  }
  return [...edges].map(([offset, x]) => ({ offset, x }));
}

function pushCaret(
  sink: ParagraphLayoutSink,
  paragraph: ParagraphRecord,
  fullText: string,
  utf16Offset: number,
  x: number,
  y: number,
  height: number,
  metrics: { readonly ascent: number; readonly descent: number; readonly lineGap: number },
  line: VisualLineIdentity,
  affinity: 'upstream' | 'downstream' = utf16Offset === 0 ? 'downstream' : 'upstream'
): void {
  sink.push({
    type: 'caretEdge',
    x,
    y,
    height,
    ascent: metrics.ascent,
    descent: metrics.descent,
    lineGap: metrics.lineGap,
    baseline: y + metrics.ascent,
    paragraphId: paragraph.id,
    graphemeOffset: utf16OffsetToGrapheme(fullText, utf16Offset),
    utf16Offset,
    affinity,
    line,
    navigable: true,
    horizontalNavigable: true,
    shaping: 'cluster-advance',
  } satisfies CaretEdgeItem);
}

export function layoutParagraphInBox(
  model: PackageModel,
  paragraph: ParagraphRecord,
  cursor: { x: number; y: number },
  contentLeft: number,
  contentRight: number,
  shaping: LayoutShapingOptions,
  sink: ParagraphLayoutSink,
  newLine: (height: number) => void,
  options: { trailingNewLine?: boolean } = {}
): { x: number; y: number; lineHeight: number } {
  const fullText = paragraphText(paragraph);
  const embedding = bidiAlgorithm.getEmbeddingLevels(fullText);
  const spans = resolveSpans(model, paragraph, shaping, embedding);
  const tracker = new LineTracker(paragraph.id);

  const defaultSpan =
    spans[0] ??
    (() => {
      const request: FontRequest = {
        family: shaping.defaultFont.family,
        weight: 400,
        style: 'normal',
      };
      const font = shaping.fonts.resolve(request);
      if (font instanceof FontResolutionError) throw font;
      return {
        from: 0,
        to: 0,
        text: '',
        props: {},
        request,
        font,
        direction: 'ltr' as const,
        bidiLevel: 0,
        script: 'Latn',
      };
    })();
  const defaultHeight = defaultShapedLineHeight(shaping);

  if (fullText.length === 0) {
    const emptyInput = shapeInput(defaultSpan, '', shaping);
    const emptyRun = shaping.shaper.shape(emptyInput);
    const line = tracker.identity(sink.currentPageIndex());
    sink.push({
      type: 'text',
      x: contentLeft,
      y: cursor.y,
      width: Math.max(1, contentRight - contentLeft),
      height: defaultHeight,
      ascent: emptyRun.metrics.ascent,
      descent: emptyRun.metrics.descent,
      lineGap: emptyRun.metrics.lineGap,
      baseline: cursor.y + emptyRun.metrics.ascent,
      text: '',
      bold: false,
      italic: false,
      direction: 'ltr',
      bidiLevel: 0,
      fontSizeHalfPoints: emptyInput.fontSizeHalfPoints,
      color: defaultSpan.props.color ?? DEFAULT_TEXT_COLOR,
      shapingEnvironment: shapingEnvironmentFingerprintInputs(emptyInput.environment),
      shapingFingerprint: shapingFingerprint(
        emptyInput,
        emptyRun,
        defaultSpan.props.color ?? DEFAULT_TEXT_COLOR,
        shaping.operation
      ),
      producer: shaping.operation,
      shapedRun: emptyRun,
      glyphClusters: glyphClusters('', emptyRun),
      anchor: { paragraphId: paragraph.id, offset: 0 },
      line,
    });
    pushCaret(
      sink,
      paragraph,
      fullText,
      0,
      cursor.x,
      cursor.y,
      defaultHeight,
      emptyRun.metrics,
      line
    );
    if (options.trailingNewLine !== false) newLine(defaultHeight);
    return { x: cursor.x, y: cursor.y, lineHeight: defaultHeight };
  }

  if (!/\S/u.test(fullText)) {
    const emptyInput = shapeInput(defaultSpan, '', shaping);
    const emptyRun = shaping.shaper.shape(emptyInput);
    sink.push({
      type: 'text',
      x: contentLeft,
      y: cursor.y,
      width: Math.max(1, contentRight - contentLeft),
      height: defaultHeight,
      ascent: emptyRun.metrics.ascent,
      descent: emptyRun.metrics.descent,
      lineGap: emptyRun.metrics.lineGap,
      baseline: cursor.y + emptyRun.metrics.ascent,
      text: '',
      bold: false,
      italic: false,
      direction: 'ltr',
      bidiLevel: 0,
      fontSizeHalfPoints: emptyInput.fontSizeHalfPoints,
      color: defaultSpan.props.color ?? DEFAULT_TEXT_COLOR,
      shapingEnvironment: shapingEnvironmentFingerprintInputs(emptyInput.environment),
      shapingFingerprint: shapingFingerprint(
        emptyInput,
        emptyRun,
        defaultSpan.props.color ?? DEFAULT_TEXT_COLOR,
        shaping.operation
      ),
      producer: shaping.operation,
      shapedRun: emptyRun,
      glyphClusters: glyphClusters('', emptyRun),
      anchor: { paragraphId: paragraph.id, offset: 0 },
      line: tracker.identity(sink.currentPageIndex()),
    });
  }

  const completeSlices = shapeRange(spans, 0, fullText.length, shaping);
  const boundaries = legalBoundaries(fullText, completeSlices);
  const boundarySet = new Set(boundaries);
  const atoms = atomsFor(fullText, completeSlices, boundaries);
  const ranges = lineRanges(
    atoms,
    spans,
    shaping,
    Math.max(1, contentRight - contentLeft),
    contentRight <= contentLeft
  );

  let lastLineHeight = defaultHeight;
  for (let lineIndex = 0; lineIndex < ranges.length; lineIndex += 1) {
    const [from, to] = ranges[lineIndex]!;
    if (lineIndex > 0) {
      tracker.wrap(sink.currentPageIndex());
      newLine(lastLineHeight);
      cursor.x = contentLeft;
    }
    const line = tracker.identity(sink.currentPageIndex());
    const slices = visualOrder(
      splitTabsForPaint(shapeRange(spans, from, to, shaping), shaping),
      fullText,
      embedding,
      from,
      to
    );
    const lineAscent = Math.max(...slices.map((slice) => slice.run.metrics.ascent));
    const lineDescent = Math.max(...slices.map((slice) => slice.run.metrics.descent));
    const lineGap = Math.max(...slices.map((slice) => slice.run.metrics.lineGap));
    const lineHeight = Math.max(defaultHeight, lineAscent + lineDescent + lineGap);
    const baseline = cursor.y + lineAscent;
    lastLineHeight = lineHeight;
    let x = cursor.x;
    const emittedEdges = new Set<string>();
    for (const slice of slices) {
      const style = slice.span.props;
      const item: TextItem = {
        type: 'text',
        x,
        y: cursor.y,
        width: slice.width,
        height: lineHeight,
        ascent: slice.run.metrics.ascent,
        descent: slice.run.metrics.descent,
        lineGap: slice.run.metrics.lineGap,
        baseline,
        text: slice.run.text,
        bold: style.bold === true,
        italic: style.italic === true,
        direction: slice.run.direction,
        bidiLevel: slice.run.bidiLevel,
        fontSizeHalfPoints: slice.input.fontSizeHalfPoints,
        color: style.color ?? DEFAULT_TEXT_COLOR,
        shapingEnvironment: shapingEnvironmentFingerprintInputs(slice.input.environment),
        shapingFingerprint: shapingFingerprint(
          slice.input,
          slice.run,
          style.color ?? DEFAULT_TEXT_COLOR,
          shaping.operation
        ),
        producer: shaping.operation,
        shapedRun: slice.run,
        glyphClusters: glyphClusters(slice.run.text, slice.run),
        anchor: { paragraphId: paragraph.id, offset: slice.from },
        line,
      };
      sink.push(item);
      for (const edge of clusterEdges(slice)) {
        if (!boundarySet.has(edge.offset)) continue;
        const affinity =
          edge.offset === 0 || (edge.offset === slice.from && slice.from !== from)
            ? 'downstream'
            : 'upstream';
        const edgeKey = `${edge.offset}:${x + edge.x}`;
        if (emittedEdges.has(edgeKey)) continue;
        emittedEdges.add(edgeKey);
        pushCaret(
          sink,
          paragraph,
          fullText,
          edge.offset,
          x + edge.x,
          cursor.y,
          lineHeight,
          { ascent: lineAscent, descent: lineDescent, lineGap },
          line,
          affinity
        );
      }
      x += slice.width;
    }
    cursor.x = x;
  }
  if (options.trailingNewLine !== false) newLine(lastLineHeight);
  return { x: cursor.x, y: cursor.y, lineHeight: lastLineHeight };
}
