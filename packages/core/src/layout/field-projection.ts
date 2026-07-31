// Safe PAGE / NUMPAGES field projection for semantic layout.
//
// Field instructions are attacker-controlled and MUST NEVER execute. This module recognizes
// only exact normalized allowlisted `PAGE` and `NUMPAGES` instructions (after stripping the
// inert Word formatting switch `\* MERGEFORMAT`). Everything else stays inert: cached result
// text between `fldChar separate`/`end` may display, but the instruction is not evaluated,
// and no external fetch / HTML / DOM geometry is consulted.
//
// Projection is a layout concern (span geometry + tab alignment), not paint-time substitution.

import {
  hardBreakText,
  WML_NAMESPACE_URI,
  type OoxmlNode,
  type OoxmlProperty,
} from '@docx-editor.dev/core-contract/store';
import { resolveRunStyle, type ResolvedRunStyle } from './run-style.ts';
import type { HeaderFooterStoryRecord, SemanticLayout } from './semantic-records.ts';

/** Caps hostile instruction blobs and nesting depth (fail closed → inert). */
export const MAX_FIELD_INSTRUCTION_CHARS = 256;
export const MAX_FIELD_NESTING = 4;

/** 1-based physical page index and document page count from semantic layout. */
export interface FieldPageContext {
  readonly pageNumber: number;
  readonly pageCount: number;
}

export type AllowlistedPageField = 'PAGE' | 'NUMPAGES';

/** One measurable piece produced while walking runs (including projected field results). */
export interface FieldAwarePiece {
  readonly text: string;
  readonly props: readonly OoxmlProperty[];
  readonly style: ResolvedRunStyle;
  /** UTF-16 model offset; projected field text uses a zero-width range at this offset. */
  readonly start: number;
  readonly end: number;
  /** True when text was projected from page context rather than model `w:t`. */
  readonly projected?: boolean;
}

const MERGEFORMAT_SUFFIX = /\s*\\\*\s*MERGEFORMAT\s*$/i;

/**
 * Normalize a raw `instrText` blob for allowlist matching.
 *
 * Trims, collapses whitespace, uppercases, and strips a trailing inert `\* MERGEFORMAT`.
 * Returns null when the instruction exceeds the length cap (hostile / truncated → inert).
 */
export function normalizeFieldInstruction(raw: string): string | null {
  if (raw.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim().toUpperCase();
  if (collapsed.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  return collapsed.replace(MERGEFORMAT_SUFFIX, '').trim();
}

/**
 * Exact allowlist for live page-field projection.
 *
 * Broader `isEvaluableField` keywords (DATE, TOC, …) remain unevaluated here on purpose.
 */
export function allowlistedPageField(instruction: string): AllowlistedPageField | null {
  const normalized = normalizeFieldInstruction(instruction);
  if (normalized === 'PAGE' || normalized === 'NUMPAGES') return normalized;
  return null;
}

/** Decimal digit string for an allowlisted page field under a page context. */
export function projectPageFieldValue(
  kind: AllowlistedPageField,
  context: FieldPageContext
): string {
  const value = kind === 'PAGE' ? context.pageNumber : context.pageCount;
  // Layout-derived counts are already bounded by pagination; still refuse non-finite junk.
  if (!Number.isFinite(value) || value < 0) return '';
  return String(Math.floor(value));
}

function attribute(node: OoxmlNode, localName: string): string | undefined {
  if (node.kind === 'textValue' || !('attributes' in node)) return undefined;
  for (const entry of node.attributes ?? []) {
    if (entry.localName === localName) return entry.value;
  }
  return undefined;
}

function isWmlGeneric(node: OoxmlNode, localName: string): boolean {
  return (
    node.kind === 'generic' &&
    'localName' in node &&
    node.localName === localName &&
    node.namespaceUri === WML_NAMESPACE_URI
  );
}

function isFldChar(node: OoxmlNode, type: 'begin' | 'separate' | 'end'): boolean {
  return isWmlGeneric(node, 'fldChar') && attribute(node, 'fldCharType') === type;
}

function isInstrText(node: OoxmlNode): boolean {
  return isWmlGeneric(node, 'instrText');
}

function textValueOf(node: OoxmlNode): string {
  if (node.kind === 'textValue') return node.value;
  let text = '';
  for (const child of node.children ?? []) text += textValueOf(child);
  return text;
}

export function propertiesOfRunContainer(container: OoxmlNode | undefined): OoxmlProperty[] {
  if (!container || container.kind === 'textValue') return [];
  const props: OoxmlProperty[] = [];
  for (const child of container.children) {
    if (child.kind === 'textValue') continue;
    const attributes: Record<string, string> = {};
    for (const entry of child.attributes) attributes[entry.localName] = entry.value;
    props.push(
      Object.keys(attributes).length > 0
        ? { localName: child.localName, attributes }
        : { localName: child.localName }
    );
  }
  return props;
}

/**
 * Flatten a paragraph into measurable pieces, projecting allowlisted PAGE/NUMPAGES when a
 * page context is supplied.
 *
 * Complex-field state spans runs. Nested fields beyond {@link MAX_FIELD_NESTING}, oversized
 * instructions, and non-allowlisted instructions never evaluate: only their cached result
 * `w:t` (if any) remains visible.
 *
 * Projected digits use a zero-width source range at the current model offset so surrounding
 * `w:t` offsets stay aligned with `paragraphTextOf` / binding.
 */
export function piecesOfParagraph(
  paragraph: OoxmlNode,
  inheritedRunProperties: readonly OoxmlProperty[] = [],
  pageContext?: FieldPageContext
): FieldAwarePiece[] {
  if (paragraph.kind === 'textValue') return [];

  const pieces: FieldAwarePiece[] = [];
  let offset = 0;

  // Field machine — document order across runs.
  let nesting = 0;
  let instruction = '';
  let instructionOverflow = false;
  let phase: 'idle' | 'instruction' | 'result' = 'idle';
  /** When true, suppress model result text because we emitted a live projection. */
  let suppressResultText = false;
  /** Nested depth exceeded the cap for the current outermost field — stay inert. */
  let nestingOverflow = false;

  const push = (
    text: string,
    props: readonly OoxmlProperty[],
    style: ResolvedRunStyle,
    projected: boolean
  ): void => {
    if (text.length === 0) return;
    if (projected) {
      pieces.push({ text, props, style, start: offset, end: offset, projected: true });
      return;
    }
    pieces.push({ text, props, style, start: offset, end: offset + text.length });
    offset += text.length;
  };

  for (const child of paragraph.children) {
    if (child.kind !== 'run') continue;
    const direct = propertiesOfRunContainer(
      child.children.find((grand) => grand.kind === 'runProperties')
    );
    const props =
      inheritedRunProperties.length === 0 ? direct : [...inheritedRunProperties, ...direct];
    const style = resolveRunStyle(props);

    for (const grand of child.children) {
      if (grand.kind === 'runProperties') continue;

      if (isFldChar(grand, 'begin')) {
        if (nesting === 0) {
          instruction = '';
          instructionOverflow = false;
          nestingOverflow = false;
          suppressResultText = false;
          phase = 'instruction';
        }
        nesting += 1;
        if (nesting > MAX_FIELD_NESTING) nestingOverflow = true;
        continue;
      }

      if (isInstrText(grand)) {
        if (phase === 'instruction' && nesting === 1 && !instructionOverflow) {
          const chunk = textValueOf(grand);
          if (instruction.length + chunk.length > MAX_FIELD_INSTRUCTION_CHARS) {
            instructionOverflow = true;
            instruction = '';
          } else {
            instruction += chunk;
          }
        }
        continue;
      }

      if (isFldChar(grand, 'separate')) {
        if (nesting === 1 && phase === 'instruction') {
          phase = 'result';
          suppressResultText = false;
          if (!instructionOverflow && !nestingOverflow && pageContext) {
            const kind = allowlistedPageField(instruction);
            if (kind) {
              push(projectPageFieldValue(kind, pageContext), props, style, true);
              suppressResultText = true;
            }
          }
        }
        continue;
      }

      if (isFldChar(grand, 'end')) {
        if (nesting > 0) nesting -= 1;
        if (nesting === 0) {
          phase = 'idle';
          instruction = '';
          instructionOverflow = false;
          nestingOverflow = false;
          suppressResultText = false;
        }
        continue;
      }

      // Ordinary run content. Instruction phase contributes no display text; result phase
      // contributes cached `w:t` unless we already projected an allowlisted page field.
      if (phase === 'instruction' && nesting >= 1) continue;
      if (phase === 'result' && suppressResultText && nesting >= 1) continue;

      let text = '';
      if (grand.kind === 'text') {
        for (const value of grand.children) if (value.kind === 'textValue') text += value.value;
      } else if (grand.kind === 'tab') text = '\t';
      else if (grand.kind === 'hardBreak') text = hardBreakText(grand);
      // Other generics (drawings, …) occupy no text offset — same as binding / indexes.
      push(text, props, style, false);
    }
  }

  return pieces;
}

/** Cache-key token for a page context; stable empty string when absent. */
export function fieldPageContextToken(context: FieldPageContext | undefined): string {
  if (!context) return '';
  return `|fld:${context.pageNumber}/${context.pageCount}`;
}

/**
 * Project allowlisted PAGE/NUMPAGES onto every page's furniture once the document page
 * count is known.
 *
 * Uses 1-based physical page indices (`page.index + 1`). Section `w:pgNumType` start/restart
 * is not modelled yet; empty `pgNumType` (the comprehensive fixture) keeps physical numbering.
 * NUMPAGES is the semantic layout total page count.
 */
export function finalizePageFieldProjection(layout: SemanticLayout): SemanticLayout {
  const pageCount = layout.pages.length;
  if (pageCount === 0) return layout;

  let changed = false;
  const pages = layout.pages.map((page) => {
    const context: FieldPageContext = {
      pageNumber: page.index + 1,
      pageCount,
    };
    const project = (
      story: HeaderFooterStoryRecord | undefined
    ): HeaderFooterStoryRecord | undefined => {
      if (!story?.pageFieldProjector) return story;
      changed = true;
      const projected = story.pageFieldProjector(context);
      // Strip the projector from the published record.
      const { pageFieldProjector: _drop, ...rest } = projected;
      void _drop;
      return rest;
    };
    const header = project(page.header);
    const footer = project(page.footer);
    if (header === page.header && footer === page.footer) return page;
    return {
      ...page,
      ...(header !== undefined ? { header } : {}),
      ...(footer !== undefined ? { footer } : {}),
    };
  });

  return changed ? { revision: layout.revision, pages } : layout;
}
