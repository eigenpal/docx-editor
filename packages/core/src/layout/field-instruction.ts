// Bounded complex-field instruction recognition for PAGE / NUMPAGES / SECTIONPAGES.
//
// Field instructions are attacker-controlled and MUST NEVER execute. This module recognizes
// only exact normalized allowlisted `PAGE`, `NUMPAGES`, and `SECTIONPAGES` instructions
// (after stripping the inert Word formatting switch `\* MERGEFORMAT`). Everything else stays
// inert. Legacy form-field payloads under `w:fldChar` (`w:ffData`, entry/exit macros) are
// never read or auto-resolved.
//
// Detection and piece projection share one bounded complex-field machine: no recursive walk
// over hostile OOXML, and node/depth/character budgets apply to instruction extraction.
// Callers reset state at paragraph boundaries so malformed cross-paragraph fields stay inert.

import {
  fldSimpleInstr,
  isFldChar as isFldCharHelper,
  isFldSimple,
  isInstrText as isInstrTextHelper,
  type OoxmlNode,
} from '@docx-editor.dev/core/store';

/** Caps hostile instruction blobs and nesting depth (fail closed → inert). */
export const MAX_FIELD_INSTRUCTION_CHARS = 256;
export const MAX_FIELD_NESTING = 4;

/**
 * Caps for furniture field-presence scans and paragraph projection walks. Attacker-controlled
 * OOXML can nest arbitrarily under `instrText`; every descendant counts against these budgets.
 * Exceeding any budget fails closed (no detect / no project).
 */
export const MAX_STORY_FIELD_SCAN_NODES = 4096;
export const MAX_STORY_FIELD_SCAN_DEPTH = 64;

export type AllowlistedPageField = 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES';

/**
 * Which allowlisted complex page fields a header/footer story actually contains.
 *
 * Drives layout reuse: no fields → one baseline; NUMPAGES only → one layout per page count;
 * SECTIONPAGES only → one layout per section page count; PAGE (alone or combined) → per
 * distinct evaluated values with a bounded cache. `w:fldSimple` never counts — it stays
 * layout-inert.
 */
export interface StoryPageFieldNeeds {
  readonly hasPage: boolean;
  readonly hasNumPages: boolean;
  readonly hasSectionPages: boolean;
}

export const NO_STORY_PAGE_FIELDS: StoryPageFieldNeeds = Object.freeze({
  hasPage: false,
  hasNumPages: false,
  hasSectionPages: false,
});

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
 * Broader keywords (DATE, TOC, INCLUDE*, DDE, …) remain unevaluated here on purpose.
 */
export function allowlistedPageField(instruction: string): AllowlistedPageField | null {
  const normalized = normalizeFieldInstruction(instruction);
  if (normalized === 'PAGE' || normalized === 'NUMPAGES' || normalized === 'SECTIONPAGES') {
    return normalized;
  }
  return null;
}

export function isFldChar(node: OoxmlNode, type: 'begin' | 'separate' | 'end'): boolean {
  return isFldCharHelper(node, type);
}

export function isInstrText(node: OoxmlNode): boolean {
  return isInstrTextHelper(node);
}

/** Shared node/depth budget for detection and paragraph projection walks. */
export interface FieldScanBudget {
  nodes: number;
  exhausted: boolean;
}

export function createScanBudget(): FieldScanBudget {
  return { nodes: 0, exhausted: false };
}

export function consumeScanNode(budget: FieldScanBudget): boolean {
  if (budget.exhausted) return false;
  budget.nodes += 1;
  if (budget.nodes > MAX_STORY_FIELD_SCAN_NODES) {
    budget.exhausted = true;
    return false;
  }
  return true;
}

/**
 * Shared complex-field parse machine used by furniture detection and piece projection.
 *
 * State spans runs in document order within one paragraph (Word's normal split of
 * begin / instrText / separate / result / end). Callers reset at paragraph boundaries so
 * malformed cross-paragraph fields stay inert. Nested fields beyond {@link MAX_FIELD_NESTING}
 * and instructions past {@link MAX_FIELD_INSTRUCTION_CHARS} fail closed.
 *
 * `w:fldChar` children (including hostile `w:ffData` / macros) are never walked for
 * evaluation — only `@w:fldCharType` is read.
 */
type FieldParsePhase = 'idle' | 'instruction' | 'result';

export interface ComplexFieldParseState {
  nesting: number;
  instruction: string;
  instructionOverflow: boolean;
  nestingOverflow: boolean;
  phase: FieldParsePhase;
}

export function createFieldParseState(): ComplexFieldParseState {
  return {
    nesting: 0,
    instruction: '',
    instructionOverflow: false,
    nestingOverflow: false,
    phase: 'idle',
  };
}

export function resetFieldParseState(state: ComplexFieldParseState): void {
  state.nesting = 0;
  state.instruction = '';
  state.instructionOverflow = false;
  state.nestingOverflow = false;
  state.phase = 'idle';
}

export function onFldCharBegin(state: ComplexFieldParseState): void {
  if (state.nesting === 0) {
    state.instruction = '';
    state.instructionOverflow = false;
    state.nestingOverflow = false;
    state.phase = 'instruction';
  }
  state.nesting += 1;
  if (state.nesting > MAX_FIELD_NESTING) state.nestingOverflow = true;
}

export function onInstrText(state: ComplexFieldParseState, chunk: string): void {
  if (state.phase !== 'instruction' || state.nesting !== 1 || state.instructionOverflow) return;
  if (state.instruction.length + chunk.length > MAX_FIELD_INSTRUCTION_CHARS) {
    state.instructionOverflow = true;
    state.instruction = '';
    return;
  }
  state.instruction += chunk;
}

/**
 * Iteratively extract `instrText` descendants into the field instruction buffer.
 *
 * Every descendant counts against the shared node budget; depth is absolute from the story
 * or paragraph root. No recursive traversal — hostile wide/deep trees cannot bypass caps.
 * Any budget miss marks the instruction inert (`instructionOverflow`).
 */
export function ingestInstrTextBounded(
  state: ComplexFieldParseState,
  instrNode: OoxmlNode,
  budget: FieldScanBudget,
  instrDepth: number
): void {
  if (state.phase !== 'instruction' || state.nesting !== 1 || state.instructionOverflow) {
    // Still charge the instrText node itself when the caller has not already.
    return;
  }
  if (instrDepth > MAX_STORY_FIELD_SCAN_DEPTH) {
    state.instructionOverflow = true;
    state.instruction = '';
    return;
  }

  // Explicit stack walk: [node, depth] pairs. The instrText element was already consumed by
  // the caller; only descendants are pushed.
  const stack: { node: OoxmlNode; depth: number }[] = [];
  const children = instrNode.kind === 'textValue' ? [] : (instrNode.children ?? []);
  for (let i = children.length - 1; i >= 0; i -= 1) {
    stack.push({ node: children[i]!, depth: instrDepth + 1 });
  }

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (!consumeScanNode(budget)) {
      state.instructionOverflow = true;
      state.instruction = '';
      return;
    }
    if (frame.depth > MAX_STORY_FIELD_SCAN_DEPTH) {
      state.instructionOverflow = true;
      state.instruction = '';
      return;
    }
    if (frame.node.kind === 'textValue') {
      onInstrText(state, frame.node.value);
      if (state.instructionOverflow) return;
      continue;
    }
    const grandChildren = frame.node.children ?? [];
    for (let i = grandChildren.length - 1; i >= 0; i -= 1) {
      stack.push({ node: grandChildren[i]!, depth: frame.depth + 1 });
    }
  }
}

/**
 * Advance past `fldChar separate`. Returns an allowlisted kind when the outermost field's
 * instruction is evaluable; otherwise null (inert / nested / overflow).
 */
export function onFldCharSeparate(state: ComplexFieldParseState): AllowlistedPageField | null {
  if (state.nesting !== 1 || state.phase !== 'instruction') return null;
  state.phase = 'result';
  if (state.instructionOverflow || state.nestingOverflow) return null;
  return allowlistedPageField(state.instruction);
}

export function onFldCharEnd(state: ComplexFieldParseState): void {
  if (state.nesting > 0) state.nesting -= 1;
  if (state.nesting === 0) resetFieldParseState(state);
}

/** True while collecting instruction text — run content in this phase is not measurable. */
export function isCollectingInstruction(state: ComplexFieldParseState): boolean {
  return state.phase === 'instruction' && state.nesting >= 1;
}

/** True while inside an outermost field result that was live-projected. */
export function isInsideFieldResult(state: ComplexFieldParseState): boolean {
  return state.phase === 'result' && state.nesting >= 1;
}

/**
 * Bounded scan for allowlisted complex page fields in a header/footer part.
 *
 * Walks the part tree with node/depth caps. Field state spans runs in document order within
 * each paragraph — the same machine paragraph projection uses — and resets at paragraph
 * boundaries so malformed cross-paragraph fields never count. Generic `w:fldSimple` is ignored
 * so detection cannot re-enable deferred body-style simple fields in furniture either.
 * Instruction text is extracted iteratively under the same node/depth/character budgets.
 */
export function detectStoryPageFields(root: OoxmlNode): StoryPageFieldNeeds {
  let hasPage = false;
  let hasNumPages = false;
  let hasSectionPages = false;
  const budget = createScanBudget();
  const field = createFieldParseState();

  const complete = (): boolean => hasPage && hasNumPages && hasSectionPages;

  const note = (kind: AllowlistedPageField): void => {
    if (kind === 'PAGE') hasPage = true;
    else if (kind === 'NUMPAGES') hasNumPages = true;
    else hasSectionPages = true;
  };

  const processFieldChild = (grand: OoxmlNode, depth: number): void => {
    if (grand.kind === 'runProperties') return;

    if (isFldChar(grand, 'begin')) {
      onFldCharBegin(field);
      return;
    }

    if (isInstrText(grand)) {
      ingestInstrTextBounded(field, grand, budget, depth);
      return;
    }

    if (isFldChar(grand, 'separate')) {
      const kind = onFldCharSeparate(field);
      if (kind) note(kind);
      return;
    }

    if (isFldChar(grand, 'end')) {
      onFldCharEnd(field);
    }
  };

  const scanRun = (run: OoxmlNode, depth: number): void => {
    if (run.kind !== 'run') return;
    for (const grand of run.children) {
      if (!consumeScanNode(budget)) return;
      processFieldChild(grand, depth + 1);
      // A drawing (or its MC wrapper) inside the run can carry a textbox story whose
      // paragraphs hold their own PAGE-family fields. Descend with the host field state
      // saved, so the nested story's paragraph resets cannot break a field that spans
      // sibling runs around the drawing.
      if (
        (grand.kind === 'drawing' || grand.kind === 'generic') &&
        !isInstrText(grand) &&
        'children' in grand &&
        grand.children.length > 0
      ) {
        const saved = { ...field };
        walk(grand, depth + 1);
        Object.assign(field, saved);
      }
      if (complete() || budget.exhausted) return;
    }
  };

  const walk = (node: OoxmlNode, depth: number): void => {
    if (complete()) return;
    if (!consumeScanNode(budget)) return;
    if (depth > MAX_STORY_FIELD_SCAN_DEPTH) return;
    if (node.kind === 'textValue') return;

    // Paragraph boundary: Word complex fields do not legally span paragraphs. Reset so a
    // begin in one paragraph cannot pair with separate/end in another.
    if (node.kind === 'paragraph') {
      resetFieldParseState(field);
      for (const child of node.children) {
        walk(child, depth + 1);
        if (complete()) return;
        if (budget.exhausted) return;
      }
      resetFieldParseState(field);
      return;
    }

    if (node.kind === 'run') {
      // Shared field state across sibling runs (and nested run containers) in this paragraph.
      scanRun(node, depth);
      return;
    }

    // `w:fldSimple` carries its instruction in an ATTRIBUTE, so none of the marker machine
    // above ever sees it. It was ignored while simple fields painted nothing — harmless then,
    // because the sheet showed a blank either way. Now that the cached result paints, ignoring
    // it is worse than the blank was: the story's page-context key stays empty, one layout is
    // reused for every sheet, and a footer `PAGE` shows page one's number on every page.
    // A wrong number is not a smaller error than a missing one, it is a quieter one.
    if (isFldSimple(node)) {
      const kind = allowlistedPageField(fldSimpleInstr(node) ?? '');
      if (kind) note(kind);
      return;
    }

    for (const child of node.children) {
      walk(child, depth + 1);
      if (complete()) return;
      if (budget.exhausted) return;
    }
  };

  walk(root, 0);
  if (!hasPage && !hasNumPages && !hasSectionPages) return NO_STORY_PAGE_FIELDS;
  return { hasPage, hasNumPages, hasSectionPages };
}
