// Bounded complex-field instruction recognition for PAGE / NUMPAGES / SECTIONPAGES.
//
// Field instructions are attacker-controlled and MUST NEVER execute. This module recognizes
// only exact normalized allowlisted `PAGE`, `NUMPAGES`, and `SECTIONPAGES` instructions with
// the numeric picture and number-format switches `field-page-switches.ts` accepts, and an `=`
// formula over them that `field-formula.ts` compiles (`= { PAGE } + 1`). Everything else stays
// inert. Legacy form-field payloads under `w:fldChar` (`w:ffData`, entry/exit
// macros) are never read or auto-resolved.
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
import {
  isDeletedInstrText,
  MAX_FIELD_INSTRUCTION_CHARS,
  MAX_FIELD_NESTING,
} from '../store/package/field-nodes.ts';
import {
  parsePageFieldInstruction,
  type PageFieldSwitches,
  type ParsedPageFieldInstruction,
} from './field-page-switches.ts';
import {
  compilePageFormula,
  MAX_FORMULA_OPERANDS,
  type FormulaOperandSlot,
  type PageFormula,
} from './field-formula.ts';

/**
 * Caps hostile instruction blobs and nesting depth (fail closed → inert).
 *
 * The character cap is the store's `MAX_FIELD_INSTRUCTION_CHARS` — one source of truth, so
 * `parsedFieldSpansOf` addressing never diverges from what this machine buffers. It matches
 * the `w:fldSimple` lane (`MAX_HYPERLINK_INSTRUCTION_CHARS`): a long `HYPERLINK` URL parses
 * identically as a complex field and as a simple field.
 */
export { MAX_FIELD_INSTRUCTION_CHARS, MAX_FIELD_NESTING };

/**
 * Caps for furniture field-presence scans and paragraph projection walks. Attacker-controlled
 * OOXML can nest arbitrarily under `instrText`; every descendant counts against these budgets.
 * Exceeding any budget fails closed (no detect / no project).
 */
export const MAX_STORY_FIELD_SCAN_NODES = 4096;
export const MAX_STORY_FIELD_SCAN_DEPTH = 64;

export type AllowlistedPageField = 'PAGE' | 'NUMPAGES' | 'SECTIONPAGES';

/**
 * Which allowlisted page fields a header/footer story actually contains.
 *
 * Drives layout reuse: no fields → one baseline; NUMPAGES only → one layout per page count;
 * SECTIONPAGES only → one layout per section page count; PAGE (alone or combined) → per
 * distinct evaluated values with a bounded cache. Counts both complex markers and
 * `w:fldSimple` (including an allowlisted page field nested inside a non-page simple field).
 */
export interface StoryPageFieldNeeds {
  readonly hasPage: boolean;
  readonly hasNumPages: boolean;
  readonly hasSectionPages: boolean;
  /**
   * The story places something by the physical sheet's parity: a header frame aligned
   * `inside` or `outside`. Set by the header/footer layout, never by field detection. The
   * story then lays out once per sheet parity, with or without a page field.
   */
  readonly hasPageParity?: boolean;
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

/** An allowlisted page field with the switches that render its value. */
export interface AllowlistedPageFieldMatch extends PageFieldSwitches {
  readonly kind: AllowlistedPageField;
  /**
   * Set for an `=` formula over a `PAGE` operand without a number format. That operand yields
   * the page number in the section's `w:pgNumType/@w:fmt`, and a formula operand must be a
   * number, so the formula has a value only when that format gives digits. See
   * {@link formulaOperandIsNumber}.
   */
  readonly formulaOperandFollowsSection?: true;
  /**
   * Set for an `=` formula with arithmetic (`= { PAGE } + 1`): the compiled expression. `kind`
   * is then its first operand's kind, and the switches render the formula's value.
   */
  readonly formula?: PageFormula;
}

/** The page fields a match reads: each operand of a formula, else its own kind. */
export function pageFieldKindsOf(
  match: AllowlistedPageFieldMatch
): readonly AllowlistedPageField[] {
  return match.formula?.kinds ?? [match.kind];
}

/**
 * Split one instruction into its keyword and its switches, in ONE read.
 *
 * Every question asked about a page-field instruction routes through here, so a
 * `fldChar separate` on the paragraph walk pays for one whitespace collapse and one bounded
 * scan rather than one of each per question. See `field-page-switches.ts` for the grammar.
 */
function splitPageFieldInstruction(raw: string): ParsedPageFieldInstruction | null {
  if (raw.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length > MAX_FIELD_INSTRUCTION_CHARS) return null;
  return parsePageFieldInstruction(collapsed);
}

/**
 * The allowlisted kind and its switches, from ONE read of the instruction.
 *
 * The keyword has to match exactly. A `\#` picture and the `\*` number formats
 * (`Arabic`, `roman`, `alphabetic`, `ArabicDash`) only decide how the computed value is
 * rendered; `\* MERGEFORMAT` and `\* CHARFORMAT` are inert. Broader keywords (DATE, TOC,
 * INCLUDE*, DDE, …) remain unevaluated here on purpose, and so does every other switch —
 * `\n`, `\* Ordinal`, `\* Upper` and a stray word leave the field inert.
 */
export function matchAllowlistedPageField(instruction: string): AllowlistedPageFieldMatch | null {
  const split = splitPageFieldInstruction(instruction);
  if (split === null) return null;
  const { keyword, ...switches } = split;
  if (keyword !== 'PAGE' && keyword !== 'NUMPAGES' && keyword !== 'SECTIONPAGES') return null;
  return { kind: keyword, ...switches };
}

/**
 * An `=` formula over nested page fields, as a page-field match. Applies at every nesting
 * level: a formula in another field's result reads the same way.
 *
 * ECMA-376 Part 1, 17.16.1 defines the `=` field (`"=", expression`), and 17.16.3 lets a
 * formula take a field that results in a single value as an operand. The operand is `PAGE`
 * (17.16.5.44), `NUMPAGES` (17.16.5.42), or `SECTIONPAGES` (17.16.5.55), nested through
 * `w:fldChar` (17.16.18, `CT_FldChar`).
 *
 * `instruction` is the formula's own text at its level, without the nested fields, and
 * `capture` holds each operand at its offset in that text (`field-formula.ts` compiles both).
 * A formula that is one operand (`= { PAGE }`) is that page field. Otherwise the match carries
 * the compiled formula. The formula's `\#` and `\*` switches (17.16.4) render the value. Each
 * operand must carry no switch other than `\* Arabic` or `\* MERGEFORMAT`.
 *
 * `hasLiveInstruction` is false when every `=` instruction chunk is a `w:delInstrText`
 * (17.16.13): the whole formula is a tracked deletion (17.13.5.14). Such a formula keeps its
 * saved result. A tracked insertion (17.13.5.18), or a tracked deletion of only an operand
 * field, still evaluates: the `=` itself stays.
 */
function formulaPageField(
  instruction: string,
  capture: FormulaCapture,
  hasLiveInstruction: boolean
): AllowlistedPageFieldMatch | null {
  if (!hasLiveInstruction || capture.inert || capture.operands.length === 0) return null;
  const slots: FormulaOperandSlot[] = [];
  for (const operand of capture.operands) {
    if (operand.match === 'open') return null;
    slots.push({ offset: operand.offset, match: operand.match });
  }
  const compiled = compilePageFormula(instruction, slots);
  if (compiled === null) return null;
  // A bare PAGE operand yields the page number in the section's format, which may not be a
  // number (`formulaOperandIsNumber`).
  const followsSection = slots.some(
    ({ match }) => match.kind === 'PAGE' && match.numberFormat === undefined
  )
    ? { formulaOperandFollowsSection: true as const }
    : {};
  const { switches } = compiled;
  if ('formula' in compiled) {
    return {
      kind: slots[0]!.match.kind,
      ...switches,
      formula: compiled.formula,
      ...followsSection,
    };
  }
  const kind = compiled.single.kind;
  if (switches.picture === undefined && switches.numberFormat === undefined) {
    return { kind, numberFormat: 'decimal', ...followsSection };
  }
  return { kind, ...switches, ...followsSection };
}

/** Exact allowlist for live page-field projection — {@link matchAllowlistedPageField}'s kind. */
export function allowlistedPageField(instruction: string): AllowlistedPageField | null {
  return matchAllowlistedPageField(instruction)?.kind ?? null;
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

/**
 * Instruction capture for one NESTED field level (2..{@link MAX_FIELD_NESTING}).
 *
 * LIVE (`w:instrText`) and DELETED (`w:delInstrText`) chunks buffer separately — see
 * {@link ComplexFieldParseState} for why concatenating them invents an instruction nobody
 * authored.
 */
interface NestedInstructionLevel {
  instruction: string;
  overflow: boolean;
  deletedInstruction: string;
  deletedOverflow: boolean;
  /** A live `instrText` element was seen — the live buffer answers, even when empty. */
  sawLive: boolean;
  separated: boolean;
  /** The fields nested in this level's instruction, as {@link formulaPageField} reads them. */
  formula: FormulaCapture;
}

export interface ComplexFieldParseState {
  nesting: number;
  /**
   * Level 1 (outermost) LIVE instruction buffer; levels 2+ live in
   * {@link ComplexFieldParseState.inner}.
   *
   * A tracked edit of a field code leaves `w:delInstrText` (the deleted chunks) NEXT TO
   * `w:instrText` (the live ones) in the same field. They buffer separately because
   * concatenating them produces an instruction nobody authored — ` PAGE  NUMPAGES ` from a
   * live NUMPAGES whose old PAGE code is still pending deletion — and that merged string
   * fails the allowlist, flips FORMTEXT addressing, and lets a large deleted chunk overflow
   * a small live instruction. The EFFECTIVE instruction is the live buffer whenever any live
   * element exists, else the deleted buffer (a fully-deleted field keeps evaluating, with
   * delete attribution). Overflow is accounted per buffer for the same reason.
   *
   * One exception: a fully-deleted `=` formula (`= { PAGE }` with only `w:delInstrText`)
   * does NOT evaluate. It keeps its saved result, while a fully-deleted plain `PAGE` still
   * shows the live value. See {@link formulaPageField}.
   */
  instruction: string;
  instructionOverflow: boolean;
  /** Level 1 DELETED (`w:delInstrText`) buffer; answers only when no live element exists. */
  deletedInstruction: string;
  deletedInstructionOverflow: boolean;
  /** A live level-1 `instrText` element was seen — the live buffer answers, even when empty. */
  sawLiveInstruction: boolean;
  nestingOverflow: boolean;
  phase: FieldParsePhase;
  /** Level N (2..{@link MAX_FIELD_NESTING}) at index N-2; deeper levels are never captured. */
  inner: NestedInstructionLevel[];
  /** The fields nested in the level-1 instruction, as {@link formulaPageField} reads them. */
  formula: FormulaCapture;
}

/**
 * The fields nested in one level's instruction (level 1 here, level N in
 * {@link NestedInstructionLevel}), each at the length its level's LIVE instruction buffer had
 * when the field began. The last one is `open` until its end, then its page-field match.
 * `inert` once anything else nests there: a field that is not a page field, a field inside an
 * operand's code, or more than {@link MAX_FORMULA_OPERANDS} operands. Replaced, never mutated,
 * so a shallow copy of the parse state keeps its own capture.
 */
interface FormulaCapture {
  readonly operands: readonly {
    readonly offset: number;
    readonly match: AllowlistedPageFieldMatch | 'open';
  }[];
  readonly inert: boolean;
}

const NO_FORMULA_OPERANDS: FormulaCapture = Object.freeze({ operands: [], inert: false });
const INERT_FORMULA: FormulaCapture = Object.freeze({ operands: [], inert: true });

export function createFieldParseState(): ComplexFieldParseState {
  return {
    nesting: 0,
    instruction: '',
    instructionOverflow: false,
    deletedInstruction: '',
    deletedInstructionOverflow: false,
    sawLiveInstruction: false,
    nestingOverflow: false,
    phase: 'idle',
    inner: [],
    formula: NO_FORMULA_OPERANDS,
  };
}

export function resetFieldParseState(state: ComplexFieldParseState): void {
  state.nesting = 0;
  state.instruction = '';
  state.instructionOverflow = false;
  state.deletedInstruction = '';
  state.deletedInstructionOverflow = false;
  state.sawLiveInstruction = false;
  state.nestingOverflow = false;
  state.phase = 'idle';
  state.inner.length = 0;
  state.formula = NO_FORMULA_OPERANDS;
}

/** The instruction that would take effect if the field's tracked edits were accepted. */
export interface EffectiveFieldInstruction {
  readonly instruction: string;
  readonly overflow: boolean;
}

/**
 * Resolve the level-1 EFFECTIVE instruction: the live buffer when any live `instrText`
 * element exists (even an empty one — accepting the deletion leaves exactly that), else the
 * deleted buffer, so a fully-deleted field keeps evaluating with delete attribution. A
 * fully-deleted `=` formula is the exception: {@link formulaPageField} refuses it.
 */
export function effectiveFieldInstruction(
  state: ComplexFieldParseState
): EffectiveFieldInstruction {
  return state.sawLiveInstruction
    ? { instruction: state.instruction, overflow: state.instructionOverflow }
    : { instruction: state.deletedInstruction, overflow: state.deletedInstructionOverflow };
}

function effectiveLevelInstruction(level: NestedInstructionLevel): EffectiveFieldInstruction {
  return level.sawLive
    ? { instruction: level.instruction, overflow: level.overflow }
    : { instruction: level.deletedInstruction, overflow: level.deletedOverflow };
}

/**
 * True when tracked deletions (`w:delInstrText`, 17.16.13) remove the code of a level-1 page
 * field or page formula and leave no live instruction: a deleted `PAGE` with no live code, or a
 * deleted `=` with only its page-field operands left. With the deletion accepted, the field has
 * no instruction and shows nothing. The caller applies this only when the field itself is not
 * a tracked deletion: a wholly deleted field keeps the behavior of {@link effectiveFieldInstruction}.
 */
export function trackedDeletionLeavesNoInstruction(state: ComplexFieldParseState): boolean {
  if (state.nesting !== 1 || state.nestingOverflow) return false;
  if (state.instructionOverflow || state.deletedInstructionOverflow) return false;
  if (state.instruction.trim().length > 0) return false;
  const { operands, inert } = state.formula;
  if (matchAllowlistedPageField(state.deletedInstruction)) return operands.length === 0;
  if (inert || operands.length === 0 || state.deletedInstruction.trim() !== '=') return false;
  return operands.every((operand) => operand.match !== 'open');
}

export function onFldCharBegin(state: ComplexFieldParseState): void {
  if (state.nesting === 0) {
    state.instruction = '';
    state.instructionOverflow = false;
    state.deletedInstruction = '';
    state.deletedInstructionOverflow = false;
    state.sawLiveInstruction = false;
    state.nestingOverflow = false;
    state.phase = 'instruction';
    state.inner.length = 0;
    state.formula = NO_FORMULA_OPERANDS;
  } else {
    noteNestedBegin(state);
  }
  state.nesting += 1;
  if (state.nesting > MAX_FIELD_NESTING) {
    state.nestingOverflow = true;
  } else if (state.nesting >= 2) {
    // A sibling reopening this level replaces its capture, so one overflowed inner field
    // never poisons the well-formed inner field after it.
    state.inner[state.nesting - 2] = {
      instruction: '',
      overflow: false,
      deletedInstruction: '',
      deletedOverflow: false,
      sawLive: false,
      separated: false,
      formula: NO_FORMULA_OPERANDS,
    };
  }
}

/**
 * True when open level `k` (1..current nesting, within {@link MAX_FIELD_NESTING}) is still in
 * its instruction phase.
 */
function levelInInstruction(state: ComplexFieldParseState, k: number): boolean {
  if (k === 1) return state.phase === 'instruction';
  const level = state.inner[k - 2];
  return level !== undefined && !level.separated;
}

function formulaOf(state: ComplexFieldParseState, k: number): FormulaCapture {
  return k === 1 ? state.formula : (state.inner[k - 2]?.formula ?? INERT_FORMULA);
}

function setFormula(state: ComplexFieldParseState, k: number, value: FormulaCapture): void {
  if (k === 1) state.formula = value;
  else {
    const level = state.inner[k - 2];
    if (level) level.formula = value;
  }
}

/** Length of level `k`'s live instruction buffer: where a field nested there now begins. */
function liveInstructionLength(state: ComplexFieldParseState, k: number): number {
  return k === 1 ? state.instruction.length : (state.inner[k - 2]?.instruction.length ?? 0);
}

/**
 * Record a nested `begin` against the formula operands of the open levels. The innermost level
 * in its instruction gains an operand at its live buffer's current length. An outer level in
 * its instruction whose operand is still in ITS instruction now holds a field nested in the
 * operand's code, which makes the formula inert. A field in the operand's saved result does
 * not: the operand is evaluated, and its result is replaced (17.16.2). Bounded by
 * {@link MAX_FIELD_NESTING}.
 */
function noteNestedBegin(state: ComplexFieldParseState): void {
  const innermost = Math.min(state.nesting, MAX_FIELD_NESTING);
  for (let k = 1; k <= innermost; k += 1) {
    if (!levelInInstruction(state, k)) continue;
    const formula = formulaOf(state, k);
    if (formula.inert) continue;
    if (k === state.nesting) {
      setFormula(
        state,
        k,
        formula.operands.length >= MAX_FORMULA_OPERANDS
          ? INERT_FORMULA
          : {
              operands: [
                ...formula.operands,
                { offset: liveInstructionLength(state, k), match: 'open' },
              ],
              inert: false,
            }
      );
    } else if (k + 1 > MAX_FIELD_NESTING || levelInInstruction(state, k + 1)) {
      setFormula(state, k, INERT_FORMULA);
    }
  }
}

/** The capture for the innermost OPEN nested level, or null at level 1 / past the depth cap. */
function innerLevelOf(state: ComplexFieldParseState): NestedInstructionLevel | null {
  if (state.nesting < 2 || state.nesting > MAX_FIELD_NESTING) return null;
  return state.inner[state.nesting - 2] ?? null;
}

/** True when the innermost open level is still in its instruction phase at all. */
function levelAcceptsInstruction(state: ComplexFieldParseState): boolean {
  if (state.nesting === 1) return state.phase === 'instruction';
  const level = innerLevelOf(state);
  return level !== null && !level.separated;
}

/** True when the innermost open level still accepts text into the given buffer. */
function collectingLevelInstruction(state: ComplexFieldParseState, deleted: boolean): boolean {
  if (!levelAcceptsInstruction(state)) return false;
  if (state.nesting === 1) {
    return deleted ? !state.deletedInstructionOverflow : !state.instructionOverflow;
  }
  const level = innerLevelOf(state)!;
  return deleted ? !level.deletedOverflow : !level.overflow;
}

/** Note a live `instrText` ELEMENT so the live buffer answers, even when it stays empty. */
function markLiveInstructionSeen(state: ComplexFieldParseState): void {
  if (state.nesting === 1) {
    state.sawLiveInstruction = true;
    return;
  }
  const level = innerLevelOf(state);
  if (level) level.sawLive = true;
}

/** Mark ONE buffer of the innermost open level inert (its own character cap). */
function overflowLevelBuffer(state: ComplexFieldParseState, deleted: boolean): void {
  if (state.nesting === 1) {
    if (deleted) {
      state.deletedInstructionOverflow = true;
      state.deletedInstruction = '';
    } else {
      state.instructionOverflow = true;
      state.instruction = '';
    }
    return;
  }
  const level = innerLevelOf(state);
  if (!level) return;
  if (deleted) {
    level.deletedOverflow = true;
    level.deletedInstruction = '';
  } else {
    level.overflow = true;
    level.instruction = '';
  }
}

/**
 * Mark the innermost open level's instruction inert entirely (budget / depth miss).
 *
 * Both buffers fail closed together: a scan that ran out of budget cannot say which chunks
 * it never saw, so neither buffer may claim to be complete.
 */
function overflowLevelInstruction(state: ComplexFieldParseState): void {
  overflowLevelBuffer(state, false);
  overflowLevelBuffer(state, true);
}

export function onInstrText(state: ComplexFieldParseState, chunk: string, deleted = false): void {
  if (!collectingLevelInstruction(state, deleted)) return;
  const level = innerLevelOf(state);
  if (!deleted) markLiveInstructionSeen(state);
  const buffer = level
    ? deleted
      ? level.deletedInstruction
      : level.instruction
    : deleted
      ? state.deletedInstruction
      : state.instruction;
  if (buffer.length + chunk.length > MAX_FIELD_INSTRUCTION_CHARS) {
    // Per-buffer accounting: a huge deleted chunk must not overflow a small live
    // instruction sitting next to it, and vice versa.
    overflowLevelBuffer(state, deleted);
    return;
  }
  if (level) {
    if (deleted) level.deletedInstruction = buffer + chunk;
    else level.instruction = buffer + chunk;
  } else if (deleted) {
    state.deletedInstruction = buffer + chunk;
  } else {
    state.instruction = buffer + chunk;
  }
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
  if (!levelAcceptsInstruction(state)) {
    // Still charge the instrText node itself when the caller has not already.
    return;
  }
  // One element is entirely live or entirely deleted — `w:delInstrText` is what a tracked
  // deletion rewrites `w:instrText` into. A live element counts as a live instruction even
  // when it holds no text: accepting the tracked deletion leaves exactly that.
  const deleted = isDeletedInstrText(instrNode);
  if (!deleted) markLiveInstructionSeen(state);
  if (!collectingLevelInstruction(state, deleted)) return;
  if (instrDepth > MAX_STORY_FIELD_SCAN_DEPTH) {
    overflowLevelInstruction(state);
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
      overflowLevelInstruction(state);
      return;
    }
    if (frame.depth > MAX_STORY_FIELD_SCAN_DEPTH) {
      overflowLevelInstruction(state);
      return;
    }
    if (frame.node.kind === 'textValue') {
      onInstrText(state, frame.node.value, deleted);
      if (!collectingLevelInstruction(state, deleted)) return;
      continue;
    }
    const grandChildren = frame.node.children ?? [];
    for (let i = grandChildren.length - 1; i >= 0; i -= 1) {
      stack.push({ node: grandChildren[i]!, depth: frame.depth + 1 });
    }
  }
}

/**
 * Advance past `fldChar separate`. Returns an allowlisted kind when the separated field's
 * instruction is evaluable; otherwise null (inert / overflow / nested too deep).
 *
 * At level 1 this also moves the machine into the result phase. At levels 2..
 * {@link MAX_FIELD_NESTING} the outer phase is untouched: the level's own capture answers, so
 * a PAGE nested inside another field's cached result is recognized instead of staying inert.
 * Deeper levels and levels whose own instruction overflowed stay null (fail closed).
 */
export function onFldCharSeparate(state: ComplexFieldParseState): AllowlistedPageFieldMatch | null {
  if (state.nesting === 1) {
    if (state.phase !== 'instruction') return null;
    state.phase = 'result';
    if (state.nestingOverflow) return null;
    const effective = effectiveFieldInstruction(state);
    if (effective.overflow) return null;
    return (
      matchAllowlistedPageField(effective.instruction) ??
      formulaPageField(effective.instruction, state.formula, state.sawLiveInstruction)
    );
  }
  const level = innerLevelOf(state);
  if (!level || level.separated) return null;
  level.separated = true;
  const effective = effectiveLevelInstruction(level);
  if (effective.overflow) return null;
  // A formula nested in another field's result evaluates the same way as one at level 1.
  return (
    matchAllowlistedPageField(effective.instruction) ??
    formulaPageField(effective.instruction, level.formula, level.sawLive)
  );
}

export function onFldCharEnd(state: ComplexFieldParseState): void {
  // The end of an operand field: the enclosing level's formula now knows that operand.
  const outer = state.nesting - 1;
  const formula = outer >= 1 && outer <= MAX_FIELD_NESTING ? formulaOf(state, outer) : null;
  const last = formula?.operands.at(-1);
  if (formula && !formula.inert && last?.match === 'open' && levelInInstruction(state, outer)) {
    const level = innerLevelOf(state);
    const effective = level ? effectiveLevelInstruction(level) : null;
    const match =
      effective && !effective.overflow ? matchAllowlistedPageField(effective.instruction) : null;
    setFormula(
      state,
      outer,
      match
        ? {
            operands: [...formula.operands.slice(0, -1), { offset: last.offset, match }],
            inert: false,
          }
        : INERT_FORMULA
    );
  }
  if (state.nesting > 0) state.nesting -= 1;
  if (state.nesting === 0) resetFieldParseState(state);
}

/** True while inside an outermost field result that was live-projected. */
export function isInsideFieldResult(state: ComplexFieldParseState): boolean {
  return state.phase === 'result' && state.nesting >= 1;
}

/**
 * Bounded scan for allowlisted page fields in a header/footer part.
 *
 * Walks the part tree with node/depth caps. Field state spans runs in document order within
 * each paragraph — the same machine paragraph projection uses — and resets at paragraph
 * boundaries so malformed cross-paragraph fields never count. Allowlisted `w:fldSimple`
 * instructions count too, and a non-page simple field is still descended so a nested complex
 * PAGE inside it is not missed. A complex PAGE nested inside another complex field's RESULT
 * counts the same way: `onFldCharSeparate` answers per level, and the separate branch below
 * notes it when projection can replace it (outer result phase, within the nesting cap).
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

  // Once a paragraph shows hostile nesting, the atomic-span parser fails closed for the
  // REST of that paragraph (`parsedFieldSpansOf` refuses the suffix rather than rescanning
  // it quadratically), so projection paints every later field there verbatim. Detection must
  // agree for the same suffix, or a footer with one hostile field pays a per-sheet layout
  // that paints identical text on every page. Cleared at paragraph boundaries.
  let paragraphPoisoned = false;

  // Notes are provisional until the OUTER span closes cleanly. A note fires at separate-time,
  // but a LATER nesting overflow in the same span demotes the whole store span (the parser
  // above breaks for the suffix), so projection paints the noted field's cached digits
  // verbatim — a note that stood would buy a per-sheet relayout of identical text. Level-1
  // notes buffer the same way: the overflow demotes the level-1 span too. Flushed at the
  // outer end when the paragraph was not poisoned; dropped otherwise.
  let pendingNotes: AllowlistedPageField[] = [];

  const processFieldChild = (grand: OoxmlNode, depth: number): void => {
    if (grand.kind === 'runProperties') return;

    if (isFldChar(grand, 'begin')) {
      onFldCharBegin(field);
      if (field.nestingOverflow) paragraphPoisoned = true;
      return;
    }

    if (isInstrText(grand)) {
      ingestInstrTextBounded(field, grand, budget, depth);
      return;
    }

    if (isFldChar(grand, 'separate')) {
      const level = field.nesting;
      const phase = field.phase;
      const match = onFldCharSeparate(field);
      if (paragraphPoisoned) return;
      // Note only what projection can actually replace. A top-level (level-1) field always
      // projects. A NESTED field projects only out of the outer field's RESULT: a page field
      // inside an outer INSTRUCTION (`IF { PAGE } = 1 "x"`) is never painted at all, and a
      // field past the nesting cap demotes to verbatim text — noting either buys a per-sheet
      // relayout that paints identical text on every page.
      // Detection does not know the section's page-number format, so a formula over a bare
      // PAGE in a roman section is noted although it keeps its saved result. The cost is only
      // a per-sheet layout that paints the same text.
      if (match && (level <= 1 || phase === 'result'))
        pendingNotes.push(...pageFieldKindsOf(match));
      return;
    }

    if (isFldChar(grand, 'end')) {
      onFldCharEnd(field);
      if (field.nesting === 0) {
        if (!paragraphPoisoned) for (const kind of pendingNotes) note(kind);
        pendingNotes.length = 0;
      }
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
        // Deep-copy the per-level captures: a shallow copy aliases the `inner` array and its
        // level objects, so the nested story's paragraph resets would empty the saved capture
        // too and a level-2 field straddling the drawing would lose its instruction. Level-1
        // fields are strings, booleans, and an immutable formula capture, which the spread
        // can share.
        const saved: ComplexFieldParseState = {
          ...field,
          inner: field.inner.map((level) => ({ ...level })),
        };
        const savedPoison = paragraphPoisoned;
        const savedPending = pendingNotes;
        pendingNotes = [];
        walk(grand, depth + 1);
        Object.assign(field, saved);
        paragraphPoisoned = savedPoison;
        pendingNotes = savedPending;
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
      paragraphPoisoned = false;
      // A span still open at a paragraph boundary is malformed and never projects; its
      // buffered notes drop with it.
      pendingNotes.length = 0;
      for (const child of node.children) {
        walk(child, depth + 1);
        if (complete()) return;
        if (budget.exhausted) return;
      }
      resetFieldParseState(field);
      paragraphPoisoned = false;
      pendingNotes.length = 0;
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
      if (kind) {
        note(kind);
        return;
      }
      // NOT a page field — fall through and keep walking. A simple field's cached result can
      // hold a complex one (`STYLEREF` wrapping a `PAGE` is ordinary in a running header), and
      // returning here hid it: the story reported no page fields, its context token stayed
      // empty, one layout served every sheet, and the number inside showed page one everywhere.
      // Exactly the failure this arm was added to prevent, one level down.
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
