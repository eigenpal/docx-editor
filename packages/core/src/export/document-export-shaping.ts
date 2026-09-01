// Document-aware font resolution shared by every headless exporter.

import { collectRenderedFontFamilyCandidates } from '../binding/document-rendered-fonts.ts';
import { validFontFamily } from '../binding/document-run-defaults.ts';
import {
  MAX_RESOLVER_FAMILIES,
  WORD_DEFAULT_FONT,
  composeFontConfiguration,
} from '../editor/font-composition.ts';
import {
  composePreparedFontOrigins,
  type FontOrigin,
  type FontOriginFailure,
} from '../editor/font-resolver.ts';
import { prepareOwnedLayoutFontConfiguration } from '../layout/layout-shaping.ts';
import {
  FontResolutionError,
  HARD_MAX_AGGREGATE_FONT_BYTES,
  type FontRequest,
  type ResolvedFont,
} from '../layout/font-resource.ts';
import { buildNumberingIndex } from '../layout/numbering-index.ts';
import { resolveStoryListItems } from '../layout/list-resolve.ts';
import { buildStyleCascadeTable } from '../layout/style-cascade.ts';
import { EQUATION_FONT_FAMILY } from '../layout/equation-layout.ts';
import { hostedTextboxContents, textboxStoryListItems } from '../layout/textbox-story-layout.ts';
import {
  createFieldParseState,
  effectiveFieldInstruction,
  isInsideFieldResult,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
  onInstrText,
  resetFieldParseState,
} from '../layout/field-instruction.ts';
import {
  complexFieldInstructionMaySynthesizeGlyph,
  simpleFieldInstructionMaySynthesizeGlyph,
} from '../layout/field-form.ts';
import { parseSymbolInstruction } from '../layout/field-symbol.ts';
import { collectNoteReferences, resolveNotesPart } from '../store/package/note-references.ts';
import { noteIdOf, noteTypeOf, type NoteKind } from '../store/package/note-nodes.ts';
import { hasLegacyFormFieldData } from '../store/package/field-nodes.ts';
import { collectFlowBlocks } from '../store/package/content-control-walk.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import {
  openHeadlessDocument,
  type HeadlessDocumentView,
} from '../store/headless-document-view.ts';
import {
  ExportResourceError,
  openDocumentForExport,
  type ExportSession,
  type OpenDocumentForExportOptions,
  type OpenDocumentForExportResult,
} from './export-session.ts';
import { createSessionExportShaping, type SharedExportShaping } from './shared-export-shaping.ts';

/** Session-owned shaping over one document-specific font composition. @internal */
export interface DocumentExportShaping extends SharedExportShaping {
  /** Release this active document's font-byte reservation. Idempotent. */
  dispose(): void;
}

/** Cancellation and deadline controls for document-specific font resolution. @internal */
export interface DocumentExportShapingOptions {
  readonly signal?: AbortSignal;
  /** Maximum time for font origins and shaping initialization. Default: 60 seconds. */
  readonly timeoutMs?: number;
  readonly fontPolicy?: 'best-effort' | 'strict';
  /** Fire-and-forget diagnostics; returned promises are observed but do not delay export. */
  readonly onFontResolution?: (report: ExportFontResolutionReport) => void;
  /** Process-byte lease observations for resource-lifecycle tests and diagnostics. @internal */
  readonly onActiveFontBytesChange?: (activeBytes: number) => void;
}

/** One paintable face in an export font-resolution report. @public */
export interface ExportFontFaceResolution {
  readonly weight: 400 | 700;
  readonly style: 'normal' | 'italic';
  readonly sourceFamily: string;
  readonly via: 'direct' | 'substitution';
}

/** Coverage of one family Core layout may request. @public */
export interface ExportFontFamilyResolution {
  readonly family: string;
  readonly coverage: 'complete' | 'partial' | 'none';
  readonly faces: readonly ExportFontFaceResolution[];
}

/** Exporter-neutral evidence for the font policy behind one layout session. @public */
export interface ExportFontResolutionReport {
  readonly requestedFamilies: readonly string[];
  readonly defaultFamily: string;
  readonly families: readonly ExportFontFamilyResolution[];
  readonly originFailures: readonly FontOriginFailure[];
}

/** Font-backed one-shot session options shared by Markdown, PDF, and future exporters. @public */
export interface OpenFontBackedDocumentForExportOptions extends Omit<
  OpenDocumentForExportOptions,
  'measurer' | 'reuseAcrossRevisions'
> {
  /** Ordered first-wins font origins resolved against this immutable DOCX. */
  readonly fonts: FontOrigin | readonly FontOrigin[];
  /** Font provisioning deadline; defaults to `resourceTimeoutMs`, then 60 seconds. */
  readonly fontResolutionTimeoutMs?: number;
  /** `strict` refuses incomplete face coverage or any failed origin. Default: `best-effort`. */
  readonly fontPolicy?: 'best-effort' | 'strict';
  /** Structured evidence for the exact font composition used to create page breaks. */
  /** Fire-and-forget diagnostics; returned promises are observed but do not delay export. */
  readonly onFontResolution?: (report: ExportFontResolutionReport) => void;
}

let activeDocumentFontBytes = 0;

function createDocumentFontByteLease(onChange?: (activeBytes: number) => void): {
  readonly reserve: (byteLength: number) => () => void;
  readonly release: () => void;
} {
  let leasedBytes = 0;
  let released = false;
  onChange?.(activeDocumentFontBytes);
  const reserve = (byteLength: number): (() => void) => {
    if (released) throw new Error('Document font-byte lease is already released');
    if (activeDocumentFontBytes + byteLength > HARD_MAX_AGGREGATE_FONT_BYTES) {
      throw new ExportResourceError(
        'layoutFailed',
        `Active document export font bytes are limited to ${HARD_MAX_AGGREGATE_FONT_BYTES}; ` +
          `requested ${byteLength} bytes with ${activeDocumentFontBytes} bytes already active`
      );
    }
    activeDocumentFontBytes += byteLength;
    leasedBytes += byteLength;
    onChange?.(activeDocumentFontBytes);
    let reservationReleased = false;
    return () => {
      if (reservationReleased || released) return;
      reservationReleased = true;
      activeDocumentFontBytes -= byteLength;
      leasedBytes -= byteLength;
      onChange?.(activeDocumentFontBytes);
    };
  };
  return {
    reserve,
    release: () => {
      if (released) return;
      released = true;
      activeDocumentFontBytes -= leasedBytes;
      leasedBytes = 0;
      onChange?.(activeDocumentFontBytes);
    },
  };
}

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/**
 * Open immutable DOCX bytes with document-aware, session-owned font shaping.
 *
 * This is the composition root exporters should use. It parses before requesting fonts, applies
 * cancellation/deadlines to provisioning, atomically binds the resulting measurer to that parsed
 * view, and releases the document-specific font lease with the returned session. Mutable views are
 * intentionally excluded: a live editor host must supply its own revision-stable measurer.
 *
 * @public
 */
export async function openFontBackedDocumentForExport(
  source: Uint8Array,
  options: OpenFontBackedDocumentForExportOptions
): Promise<OpenDocumentForExportResult> {
  const opened = openHeadlessDocument(source);
  if (!opened.ok) return opened;
  const { fonts, fontResolutionTimeoutMs, fontPolicy, onFontResolution, ...sessionOptions } =
    options;
  const origins = Array.isArray(fonts) ? fonts : [fonts as FontOrigin];
  const shaping = await acquireDocumentExportShaping(opened.view, origins, {
    signal: options.signal,
    timeoutMs: fontResolutionTimeoutMs ?? options.resourceTimeoutMs,
    fontPolicy,
    onFontResolution,
  });
  if (!shaping) {
    throw new ExportResourceError(
      'layoutFailed',
      'Font-backed export requires at least one admitted font source'
    );
  }
  let result: OpenDocumentForExportResult;
  try {
    result = openDocumentForExport(opened.view, {
      ...sessionOptions,
      reuseAcrossRevisions: false,
      measurer: shaping.createMeasurer(),
      producer: options.producer ?? shaping.producer,
    });
  } catch (error) {
    shaping.dispose();
    throw error;
  }
  if (!result.ok) {
    shaping.dispose();
    return result;
  }
  const session = result.session;
  let ownedShaping: DocumentExportShaping | undefined = shaping;
  let disposed = false;
  return {
    ok: true,
    session: Object.freeze({
      layout: () => session.layout(),
      layoutFor: (displayMode: Parameters<ExportSession['layoutFor']>[0]) =>
        session.layoutFor(displayMode),
      validatedImageBytes: (drawing: Parameters<ExportSession['validatedImageBytes']>[0]) =>
        session.validatedImageBytes(drawing),
      dispose() {
        if (disposed) return;
        disposed = true;
        try {
          session.dispose();
        } finally {
          ownedShaping?.dispose();
          ownedShaping = undefined;
        }
      },
    }),
  };
}

/**
 * Resolve ordered font origins for one document and acquire its shared HarfBuzz substrate.
 *
 * Origins are first-wins, exactly like browser editor font origins. Resolvers receive only the
 * bounded family catalog declared by the body, styles, headers, footers, and notes. An empty or
 * unresolved origin list returns `undefined`; callers can then retain Core's deterministic fixed
 * measurer. Network-backed origins therefore remain an explicit exporter-host decision.
 *
 * @internal
 */
export async function acquireDocumentExportShaping(
  view: HeadlessDocumentView,
  origins: readonly FontOrigin[],
  options: DocumentExportShapingOptions = {}
): Promise<DocumentExportShaping | undefined> {
  const timeoutMs = normalizedTimeout(options.timeoutMs);
  const controller = new AbortController();
  const abortFromHost = (): void => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abortFromHost, { once: true });
  if (options.signal?.aborted) abortFromHost();
  const timer = setTimeout(() => controller.abort('font-resolution-timeout'), timeoutMs);

  try {
    throwIfAborted(controller.signal);
    const work = (async (): Promise<DocumentExportShaping | undefined> => {
      const fontByteLease = createDocumentFontByteLease(options.onActiveFontBytesChange);
      let leaseTransferred = false;
      try {
        const families = documentFontFamilies(view);
        if (families.length > MAX_RESOLVER_FAMILIES) {
          throw new ExportResourceError(
            'layoutFailed',
            `Document export requires ${families.length} font families; the safe resolver limit is ${MAX_RESOLVER_FAMILIES}`
          );
        }
        const originFailures: FontOriginFailure[] = [];
        const resolved = await composePreparedFontOrigins(
          origins,
          {
            families,
            defaultFamily: WORD_DEFAULT_FONT.family,
            signal: controller.signal,
          },
          {
            onOriginFailure: (failure) => originFailures.push(failure),
            reserveOwnedBytes: fontByteLease.reserve,
          }
        );
        throwIfAborted(controller.signal);
        const configuration = composeFontConfiguration(resolved ?? {});
        if (configuration.sources.length === 0) {
          const report = fontResolutionReport(
            families,
            configuration.defaultFont.family,
            originFailures
          );
          publishFontResolutionReport(report, options);
          enforceStrictFontPolicy(report, options);
          return undefined;
        }
        const shaping = await createSessionExportShaping(
          prepareOwnedLayoutFontConfiguration(configuration)
        );
        throwIfAborted(controller.signal);
        const report = fontResolutionReport(
          families,
          configuration.defaultFont.family,
          originFailures,
          shaping.resolveFont
        );
        publishFontResolutionReport(report, options);
        enforceStrictFontPolicy(report, options);
        leaseTransferred = true;
        return Object.freeze({
          ...shaping,
          dispose: fontByteLease.release,
        });
      } finally {
        if (!leaseTransferred) fontByteLease.release();
      }
    })();
    return await Promise.race([work, abortFailure(controller.signal)]);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromHost);
  }
}

function normalizedTimeout(value: number | undefined): number {
  if (value === undefined) return 60_000;
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError('timeoutMs must be a positive finite number');
  }
  return Math.max(1, value);
}

function abortFailure(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    const fail = (): void => {
      reject(exportAbortError(signal));
    };
    if (signal.aborted) fail();
    else signal.addEventListener('abort', fail, { once: true });
  });
}

function exportAbortError(signal: AbortSignal): ExportResourceError {
  const timedOut = signal.reason === 'font-resolution-timeout';
  return new ExportResourceError(
    timedOut ? 'timedOut' : 'aborted',
    timedOut ? 'Font resolution timed out' : 'Font resolution was aborted',
    timedOut ? undefined : { cause: signal.reason }
  );
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw exportAbortError(signal);
}

const REQUIRED_FACE_VARIANTS = Object.freeze([
  { weight: 400 as const, style: 'normal' as const },
  { weight: 700 as const, style: 'normal' as const },
  { weight: 400 as const, style: 'italic' as const },
  { weight: 700 as const, style: 'italic' as const },
]);

function fontResolutionReport(
  requestedFamilies: readonly string[],
  defaultFamily: string,
  originFailures: readonly FontOriginFailure[],
  resolve?: (request: FontRequest) => ResolvedFont | FontResolutionError
): ExportFontResolutionReport {
  const familyNames = new Map<string, string>();
  for (const family of [...requestedFamilies, defaultFamily]) {
    const fold = family.toLowerCase();
    if (!familyNames.has(fold)) familyNames.set(fold, family);
  }
  const families = [...familyNames.values()].map((family): ExportFontFamilyResolution => {
    const faces: ExportFontFaceResolution[] = [];
    for (const variant of REQUIRED_FACE_VARIANTS) {
      const answer = resolve?.({ family, ...variant });
      if (!answer || answer instanceof FontResolutionError) continue;
      faces.push(
        Object.freeze({
          ...variant,
          sourceFamily: answer.family,
          via: answer.substitution ? ('substitution' as const) : ('direct' as const),
        })
      );
    }
    return Object.freeze({
      family,
      coverage: faces.length === 4 ? 'complete' : faces.length > 0 ? 'partial' : 'none',
      faces: Object.freeze(faces),
    });
  });
  return Object.freeze({
    requestedFamilies: Object.freeze([...requestedFamilies]),
    defaultFamily,
    families: Object.freeze(families),
    originFailures: Object.freeze([...originFailures]),
  });
}

function publishFontResolutionReport(
  report: ExportFontResolutionReport,
  options: DocumentExportShapingOptions
): void {
  if (options.onFontResolution) {
    try {
      const result = (options.onFontResolution as (value: ExportFontResolutionReport) => unknown)(
        report
      );
      void Promise.resolve(result).catch((cause: unknown) => {
        console.warn('[fonts] font-resolution diagnostics callback failed', cause);
      });
    } catch (cause) {
      throw new ExportResourceError(
        'layoutFailed',
        'The font-resolution diagnostics callback failed',
        { cause }
      );
    }
    return;
  }
  for (const failure of report.originFailures) {
    console.warn('[fonts] a document export font origin failed and was skipped', failure);
  }
}

function enforceStrictFontPolicy(
  report: ExportFontResolutionReport,
  options: DocumentExportShapingOptions
): void {
  if (
    options.fontPolicy !== 'strict' ||
    (report.originFailures.length === 0 &&
      report.families.every((family) => family.coverage === 'complete'))
  ) {
    return;
  }
  const incomplete = report.families
    .filter((family) => family.coverage !== 'complete')
    .map((family) => family.family)
    .join(', ');
  throw new ExportResourceError(
    'layoutFailed',
    `Strict font policy refused export${incomplete ? `; incomplete families: ${incomplete}` : '; a font origin failed'}`
  );
}

function documentFontFamilies(view: HeadlessDocumentView): readonly string[] {
  const bodyRoots: OoxmlElement[] = [view.part().root];
  const furnitureRoots: OoxmlElement[] = [];
  const noteRoots: OoxmlElement[] = [];
  const seen = new Set<string>([view.part().name]);
  const append = (
    into: OoxmlElement[],
    part: { readonly name: string; readonly root: OoxmlElement } | null
  ): void => {
    if (!part || seen.has(part.name)) return;
    seen.add(part.name);
    into.push(part.root);
  };

  for (const section of view.headerFooterPartsBySection()) {
    for (const part of section.headers.values()) append(furnitureRoots, part);
    for (const part of section.footers.values()) append(furnitureRoots, part);
  }
  for (const kind of ['footnote', 'endnote'] as const) {
    noteRoots.push(...referencedNoteRoots(view, kind));
  }
  const headlessTheme = view.documentThemeFonts();
  const theme = {
    major: headlessTheme.major,
    minor: headlessTheme.minor,
    majorEastAsia: headlessTheme.majorEastAsia ?? null,
    minorEastAsia: headlessTheme.minorEastAsia ?? null,
  };
  const byFold = new Map<string, string>();
  const appendStoryTier = (
    roots: readonly OoxmlElement[],
    context: 'body' | 'furniture' | 'note' | 'detached'
  ): void => {
    const rendered = collectRenderedFontFamilyCandidates(
      roots,
      view.stylesRoot(),
      theme,
      synthesizedFieldGlyphIds(roots, context)
    );
    const markerFamilies = usedNumberingFontFamilies(
      roots,
      view.numberingRoot(),
      view.stylesRoot(),
      theme
    );
    for (const family of [
      ...rendered.direct,
      ...layoutSynthesizedFontFamilies(roots),
      ...markerFamilies,
      ...rendered.inherited,
    ]) {
      const fold = family.toLowerCase();
      if (!byFold.has(fold)) byFold.set(fold, family);
    }
  };
  // Preserve the visible document body before any bounded secondary story catalog. Within each
  // tier, direct/synthetic/marker faces precede inherited candidates. This keeps a hostile header
  // or orphan note from crowding the body's active Normal face out of the resolver cap.
  appendStoryTier(bodyRoots, 'body');
  appendStoryTier(furnitureRoots, 'furniture');
  appendStoryTier(noteRoots, 'note');
  return [...byFold.values()];
}

function referencedNoteRoots(view: HeadlessDocumentView, kind: NoteKind): readonly OoxmlElement[] {
  const part = resolveNotesPart(view.currentPackage(), kind);
  if (!part) return [];
  const referenced = new Set(
    collectNoteReferences(view.part())
      .filter((hit) => hit.noteKind === kind)
      .map((hit) => hit.noteId)
  );
  const roots: OoxmlElement[] = [];
  for (const child of part.root.children) {
    if (child.kind === 'textValue') continue;
    const type = noteTypeOf(child);
    const id = noteIdOf(child);
    if (
      type === 'separator' ||
      type === 'continuationSeparator' ||
      (id !== null && referenced.has(id))
    ) {
      roots.push(child as OoxmlElement);
    }
  }
  return roots;
}

const OMML_NAMESPACE_URI = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

/**
 * Nodes whose visible text is created by field projection instead of stored in a glyph run.
 *
 * This deliberately follows the bounded field parser and records only a well-formed PAGE-family
 * or SYMBOL field with no cached result. Generic `fldChar` runs are metadata, not glyphs: treating
 * all three marker runs as visible leaks inert font declarations to resolvers and can crowd real
 * document faces out of the bounded catalog.
 */
function synthesizedFieldGlyphIds(
  roots: readonly OoxmlElement[],
  storyContext: 'body' | 'furniture' | 'note' | 'detached'
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const root of roots) {
    const paragraphs: Array<{
      paragraph: OoxmlElement;
      context: 'body' | 'furniture' | 'note' | 'detached';
    }> = [];
    const rootStack: Array<{
      node: OoxmlElement;
      context: 'body' | 'furniture' | 'note' | 'detached';
    }> = [{ node: root, context: storyContext }];
    while (rootStack.length > 0) {
      const { node, context } = rootStack.pop()!;
      if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') {
        paragraphs.push({ paragraph: node, context });
      }
      const childContext =
        node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'txbxContent'
          ? context === 'body' || context === 'note'
            ? 'detached'
            : context
          : context;
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index]!;
        if (child.kind !== 'textValue') {
          rootStack.push({ node: child as OoxmlElement, context: childContext });
        }
      }
    }
    for (const paragraph of paragraphs) {
      collectParagraphSynthesizedFieldGlyphIds(paragraph.paragraph, ids, paragraph.context);
    }
  }
  return ids;
}

function collectParagraphSynthesizedFieldGlyphIds(
  paragraph: OoxmlElement,
  ids: Set<string>,
  context: 'body' | 'furniture' | 'note' | 'detached'
): void {
  const state = createFieldParseState();
  let beginRunId: string | null = null;
  let separateRunId: string | null = null;
  let instruction = '';
  let instructionOverflow = false;
  let hadSeparate = false;
  let hasLegacyFormData = false;
  let resultVisibility = 0;
  const stack: Array<{
    node: OoxmlElement;
    runId: string | null;
    visibility: number;
  }> = [];
  for (let index = paragraph.children.length - 1; index >= 0; index -= 1) {
    const child = paragraph.children[index]!;
    if (child.kind !== 'textValue') {
      stack.push({ node: child as OoxmlElement, runId: null, visibility: ALL_REVISION_VIEWS });
    }
  }

  while (stack.length > 0) {
    const { node, runId: inheritedRunId, visibility } = stack.pop()!;
    // A textbox is a distinct story with its own paragraph field state. It is discovered by
    // the root walk and processed separately; never let its markers nest into the host paragraph.
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') continue;
    const runId =
      node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'r' ? node.id : inheritedRunId;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldSimple') {
      const raw = attributeValue(node, 'instr') ?? '';
      if (
        simpleFieldInstructionMaySynthesizeGlyph(raw, {
          allowPageFields: context === 'body' || context === 'furniture',
          allowRefFields: context === 'body' || context === 'note',
          allowPageRef: context === 'body',
          allowAutonum: context === 'body' || context === 'note',
        }) &&
        fieldSubtreeResultVisibility(node) !== ALL_REVISION_VIEWS
      ) {
        ids.add(node.id);
      }
    }
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldChar') {
      const kind = attributeValue(node, 'fldCharType');
      if (kind === 'begin') {
        onFldCharBegin(state);
        if (state.nesting === 1) {
          beginRunId = runId;
          separateRunId = null;
          instruction = '';
          instructionOverflow = false;
          hadSeparate = false;
          hasLegacyFormData = hasLegacyFormFieldData(node);
          resultVisibility = 0;
        }
      } else if (kind === 'separate') {
        const outermost = state.nesting === 1;
        onFldCharSeparate(state);
        if (outermost) {
          const effective = effectiveFieldInstruction(state);
          instruction = effective.instruction;
          instructionOverflow = effective.overflow || state.nestingOverflow;
          separateRunId = runId;
          hadSeparate = true;
        }
      } else if (kind === 'end') {
        if (state.nesting === 1) {
          if (state.phase === 'instruction') {
            const effective = effectiveFieldInstruction(state);
            instruction = effective.instruction;
            instructionOverflow = effective.overflow || state.nestingOverflow;
          }
          const synthesizes =
            !instructionOverflow &&
            complexFieldInstructionMaySynthesizeGlyph(instruction, {
              hasSeparate: hadSeparate,
              hasLegacyFormData,
              allowPageFields: context === 'body' || context === 'furniture',
              allowRefFields: context === 'body' || context === 'note',
              allowPageRef: context === 'body',
              allowAutonum: context === 'body' || context === 'note',
            });
          if (synthesizes && resultVisibility !== ALL_REVISION_VIEWS) {
            const projectedRunId = separateRunId ?? beginRunId;
            if (projectedRunId) ids.add(projectedRunId);
          }
        }
        onFldCharEnd(state);
      }
      // Field-marker payload (`ffData`, macros) is never instruction or visible result text.
      continue;
    }
    if (
      node.namespaceUri === WML_NAMESPACE_URI &&
      (node.localName === 'instrText' || node.localName === 'delInstrText')
    ) {
      onInstrText(state, boundedTextContent(node), node.localName === 'delInstrText');
      continue;
    }
    if (
      state.nesting > 0 &&
      isInsideFieldResult(state) &&
      node.namespaceUri === WML_NAMESPACE_URI &&
      fieldResultElementPaints(node)
    ) {
      resultVisibility |= visibility;
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]!;
      if (child.kind !== 'textValue') {
        stack.push({
          node: child as OoxmlElement,
          runId,
          visibility: visibility & revisionWrapperVisibility(node),
        });
      }
    }
  }
  resetFieldParseState(state);
}

function fieldResultElementPaints(node: OoxmlElement): boolean {
  if (node.localName === 't' || node.localName === 'delText') {
    return boundedTextContent(node).length > 0;
  }
  return node.localName === 'sym' || node.localName === 'tab' || node.localName === 'br';
}

const ALL_MARKUP_VIEW = 1;
const PROPOSED_VIEW = 2;
const ORIGINAL_VIEW = 4;
const ALL_REVISION_VIEWS = ALL_MARKUP_VIEW | PROPOSED_VIEW | ORIGINAL_VIEW;

function fieldSubtreeResultVisibility(field: OoxmlElement): number {
  const stack: Array<{ node: OoxmlElement; visibility: number }> = [];
  for (const child of field.children) {
    if (child.kind !== 'textValue') {
      stack.push({ node: child as OoxmlElement, visibility: ALL_REVISION_VIEWS });
    }
  }
  let resultVisibility = 0;
  while (stack.length > 0) {
    const { node, visibility } = stack.pop()!;
    // Nested textbox paragraphs reset field state and are visited independently by the caller.
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') continue;
    if (node.namespaceUri === WML_NAMESPACE_URI && fieldResultElementPaints(node)) {
      resultVisibility |= visibility;
      if (resultVisibility === ALL_REVISION_VIEWS) return resultVisibility;
    }
    for (const child of node.children) {
      if (child.kind !== 'textValue') {
        stack.push({
          node: child as OoxmlElement,
          visibility: visibility & revisionWrapperVisibility(node),
        });
      }
    }
  }
  return resultVisibility;
}

function revisionWrapperVisibility(node: OoxmlElement): number {
  if (node.namespaceUri !== WML_NAMESPACE_URI) return ALL_REVISION_VIEWS;
  if (node.localName === 'ins' || node.localName === 'moveTo') {
    return ALL_MARKUP_VIEW | PROPOSED_VIEW;
  }
  if (node.localName === 'del' || node.localName === 'moveFrom') {
    return ALL_MARKUP_VIEW | ORIGINAL_VIEW;
  }
  return ALL_REVISION_VIEWS;
}

/** Faces selected by layout semantics rather than a glyph-bearing run's `w:rFonts`. */
function layoutSynthesizedFontFamilies(roots: readonly OoxmlElement[]): readonly string[] {
  const byFold = new Map<string, string>();
  const add = (candidate: string | null): void => {
    const family = validFontFamily(candidate ?? undefined);
    if (family === null) return;
    const fold = family.toLowerCase();
    if (!byFold.has(fold)) byFold.set(fold, family);
  };
  for (const root of roots) {
    const stack: OoxmlElement[] = [root];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (node.namespaceUri === OMML_NAMESPACE_URI) add(EQUATION_FONT_FAMILY);
      if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldSimple') {
        const instruction = attributeValue(node, 'instr');
        add(parseSymbolInstruction(instruction ?? '')?.font ?? null);
      }
      if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') {
        for (const family of complexSymbolFieldFonts(node)) add(family);
      }
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        const child = node.children[index]!;
        if (child.kind !== 'textValue') stack.push(child as OoxmlElement);
      }
    }
  }
  return [...byFold.values()];
}

function complexSymbolFieldFonts(paragraph: OoxmlElement): readonly string[] {
  const families: string[] = [];
  const state = createFieldParseState();
  const stack: OoxmlElement[] = [];
  for (let index = paragraph.children.length - 1; index >= 0; index -= 1) {
    const child = paragraph.children[index]!;
    if (child.kind !== 'textValue') stack.push(child as OoxmlElement);
  }
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') continue;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldChar') {
      const kind = attributeValue(node, 'fldCharType');
      if (kind === 'begin') onFldCharBegin(state);
      else if (kind === 'separate') {
        if (state.nesting === 1) noteEffectiveSymbolFont(state, families);
        onFldCharSeparate(state);
      } else if (kind === 'end') {
        if (state.nesting === 1) noteEffectiveSymbolFont(state, families);
        onFldCharEnd(state);
      }
      continue;
    }
    if (
      node.namespaceUri === WML_NAMESPACE_URI &&
      (node.localName === 'instrText' || node.localName === 'delInstrText')
    ) {
      onInstrText(state, boundedTextContent(node), node.localName === 'delInstrText');
      continue;
    }
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldSimple') {
      const spec = parseSymbolInstruction(attributeValue(node, 'instr') ?? '');
      if (spec?.font) families.push(spec.font);
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]!;
      if (child.kind !== 'textValue') stack.push(child as OoxmlElement);
    }
  }
  resetFieldParseState(state);
  return families;
}

function noteEffectiveSymbolFont(
  state: ReturnType<typeof createFieldParseState>,
  families: string[]
): void {
  const effective = effectiveFieldInstruction(state);
  if (effective.overflow) return;
  const spec = parseSymbolInstruction(effective.instruction);
  if (spec?.font) families.push(spec.font);
}

function boundedTextContent(root: OoxmlElement): string {
  let text = '';
  const stack = [...root.children].reverse();
  while (stack.length > 0 && text.length <= 256) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') text += node.value;
    else {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]!);
      }
    }
  }
  return text;
}

function usedNumberingFontFamilies(
  storyRoots: readonly OoxmlElement[],
  numberingRoot: OoxmlElement | null,
  stylesRoot: OoxmlElement | null,
  theme: {
    readonly major: string | null;
    readonly minor: string | null;
    readonly majorEastAsia: string | null;
    readonly minorEastAsia: string | null;
  }
): readonly string[] {
  if (!numberingRoot) return [];
  const numbering = buildNumberingIndex(numberingRoot);
  const styles = buildStyleCascadeTable(stylesRoot, theme);
  const byFold = new Map<string, string>();
  for (const root of storyRoots) {
    for (const container of storyFlowContainers(root)) {
      const blocks = collectFlowBlocks(container.children);
      const noteItems = (
        items:
          | ReadonlyMap<
              string,
              {
                readonly markerStyle: {
                  readonly fontFamily?: string | null;
                  readonly fontFamilyEastAsia?: string | null;
                };
              }
            >
          | undefined
      ): void => {
        if (!items) return;
        for (const item of items.values()) {
          for (const candidate of [
            item.markerStyle.fontFamily,
            item.markerStyle.fontFamilyEastAsia,
          ]) {
            const family = validFontFamily(candidate ?? undefined);
            if (family === null) continue;
            const fold = family.toLowerCase();
            if (!byFold.has(fold)) byFold.set(fold, family);
          }
        }
      };
      noteItems(resolveStoryListItems(blocks, numbering, styles));
      for (const block of blocks) {
        const hosted = hostedTextboxContents(block);
        for (const content of hosted.contents) {
          noteItems(textboxStoryListItems(content, numbering, styles));
        }
      }
    }
  }
  return [...byFold.values()].sort((left, right) => left.localeCompare(right));
}

function storyFlowContainers(root: OoxmlElement): readonly OoxmlElement[] {
  if (root.localName === 'document') {
    for (const candidate of root.children) {
      if (candidate.kind !== 'textValue' && candidate.localName === 'body') {
        return [candidate as OoxmlElement];
      }
    }
    return [];
  }
  if (root.localName === 'footnotes' || root.localName === 'endnotes') {
    const notes: OoxmlElement[] = [];
    for (const candidate of root.children) {
      if (
        candidate.kind !== 'textValue' &&
        (candidate.localName === 'footnote' || candidate.localName === 'endnote')
      ) {
        notes.push(candidate as OoxmlElement);
      }
    }
    return notes;
  }
  return [root];
}
