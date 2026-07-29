// DocOp validation + application (document-engine task 4.3). Every op is
// JSON-safe and runtime-schema validated before it can mutate; application runs
// through the authored-model primitives (src/model) and records the structural
// effect that feeds ModelChange. Handlers are pure: (model, op) -> (model, effect).

import {
  appendParagraph,
  insertParagraph,
  insertTextIntoParagraph,
  setParagraphRuns,
  splitParagraph,
  joinParagraphs,
  moveBlock,
  replaceParagraph,
  deleteParagraph,
  type PackageModel,
  type ParagraphRecord,
  MAX_RUN_SIZE_HALF_POINTS,
  isUnderlineColor,
  isUnderlineVariant,
} from '../model/index.ts';
import { DEPENDENCY_KEY_IDS } from '../registry/frozen-ids.ts';
import type { DocOp, OpEffect } from './contracts.ts';
import { isValidXmlText } from '../package/sinks.ts';

export type DocOpValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const RUN_PROP_KEYS = new Set([
  'styleId',
  'bold',
  'italic',
  'underline',
  'fonts',
  'sizeHalfPoints',
  'color',
]);
const FONT_KEYS = new Set([
  'ascii',
  'hAnsi',
  'eastAsia',
  'cs',
  'asciiTheme',
  'hAnsiTheme',
  'eastAsiaTheme',
  'csTheme',
]);
const THEME_FONT_VALUES = new Set([
  'majorAscii',
  'majorHAnsi',
  'majorEastAsia',
  'majorBidi',
  'minorAscii',
  'minorHAnsi',
  'minorEastAsia',
  'minorBidi',
]);

function isRunProps(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const props = value as Record<string, unknown>;
  if (Object.keys(props).some((key) => !RUN_PROP_KEYS.has(key))) return false;
  if (props.styleId !== undefined && (!isStr(props.styleId) || !isValidXmlText(props.styleId)))
    return false;
  for (const key of ['bold', 'italic'])
    if (props[key] !== undefined && typeof props[key] !== 'boolean') return false;
  // Underline is a record, not a toggle: `val` must be an ST_Underline value and `color`,
  // when present, an ST_HexColor. Both are written straight into `w:u` on save, so an
  // unvalidated value here would be XML-attribute injection from a DocOp.
  if (props.underline !== undefined) {
    const u = props.underline;
    if (typeof u !== 'object' || u === null || Array.isArray(u)) return false;
    const underline = u as Record<string, unknown>;
    if (Object.keys(underline).some((key) => key !== 'val' && key !== 'color')) return false;
    if (!isUnderlineVariant(underline.val)) return false;
    if (underline.color !== undefined && !isUnderlineColor(underline.color)) return false;
  }
  if (props.sizeHalfPoints !== undefined) {
    const size = props.sizeHalfPoints;
    if (
      typeof size !== 'number' ||
      !Number.isFinite(size) ||
      !Number.isInteger(size) ||
      size < 0 ||
      size > MAX_RUN_SIZE_HALF_POINTS
    )
      return false;
  }
  if (
    props.color !== undefined &&
    (typeof props.color !== 'string' || !/^(?:auto|[0-9A-Fa-f]{6})$/.test(props.color))
  )
    return false;
  if (props.fonts !== undefined) {
    if (typeof props.fonts !== 'object' || props.fonts === null || Array.isArray(props.fonts))
      return false;
    const fonts = props.fonts as Record<string, unknown>;
    if (Object.keys(fonts).length === 0) return false;
    if (Object.keys(fonts).some((key) => !FONT_KEYS.has(key))) return false;
    for (const [key, font] of Object.entries(fonts)) {
      if (!isStr(font) || !isValidXmlText(font)) return false;
      if (key.endsWith('Theme') && !THEME_FONT_VALUES.has(font)) return false;
    }
  }
  return true;
}

/** Every run must be an object with a string `text` (props, if present, an object) — so a
 *  malformed run can never reach normalization/serialization and throw or coerce silently. */
const isRuns = (v: unknown): boolean =>
  Array.isArray(v) &&
  v.every((r) => {
    if (typeof r !== 'object' || r === null) return false;
    const rec = r as { text?: unknown; props?: unknown };
    if (typeof rec.text !== 'string') return false;
    return rec.props === undefined || isRunProps(rec.props);
  });

/** Schema-validate a DocOp's shape before any mutation (task 4.4 entry point). */
export function validateDocOp(op: DocOp): DocOpValidation {
  switch (op.op) {
    case 'appendParagraph':
      return isStr(op.storyId) ? { ok: true } : { ok: false, reason: 'appendParagraph.storyId' };
    case 'insertParagraph':
      return isStr(op.storyId) && isInt(op.index) && isRuns(op.runs)
        ? { ok: true }
        : { ok: false, reason: 'insertParagraph.fields' };
    case 'insertText':
      return isStr(op.paragraphId) &&
        typeof op.text === 'string' &&
        (op.props === undefined || isRunProps(op.props))
        ? { ok: true }
        : { ok: false, reason: 'insertText.fields' };
    case 'splitParagraph':
      return isStr(op.paragraphId) && isInt(op.offset)
        ? { ok: true }
        : { ok: false, reason: 'splitParagraph.fields' };
    case 'joinParagraphs':
      return isStr(op.firstId) && isStr(op.secondId)
        ? { ok: true }
        : { ok: false, reason: 'joinParagraphs.fields' };
    case 'moveBlock':
      return isStr(op.storyId) && isInt(op.fromIndex) && isInt(op.toIndex)
        ? { ok: true }
        : { ok: false, reason: 'moveBlock.fields' };
    case 'replaceParagraph':
      return isStr(op.paragraphId) && isRuns(op.runs)
        ? { ok: true }
        : { ok: false, reason: 'replaceParagraph.fields' };
    case 'setParagraphRuns':
      return isStr(op.paragraphId) && isRuns(op.runs)
        ? { ok: true }
        : { ok: false, reason: 'setParagraphRuns.fields' };
    case 'deleteParagraph':
      return isStr(op.paragraphId)
        ? { ok: true }
        : { ok: false, reason: 'deleteParagraph.paragraphId' };
    default:
      return { ok: false, reason: `unknown op ${(op as { op: string }).op}` };
  }
}

const storyDep = [DEPENDENCY_KEY_IDS.story];

function indexOfBlock(
  model: PackageModel,
  storyId: string,
  predicate: (b: ParagraphRecord) => boolean
): number {
  const story = model.stories.get(storyId);
  return story ? story.blocks.findIndex((b) => predicate(b as ParagraphRecord)) : -1;
}

/** Apply one validated DocOp, returning the new model and its structural effect. */
export function applyDocOp(
  model: PackageModel,
  op: DocOp
): { model: PackageModel; effect: OpEffect } {
  switch (op.op) {
    case 'appendParagraph': {
      const { model: m, paragraphId } = appendParagraph(model, op.storyId);
      return {
        model: m,
        effect: {
          dirty: [op.storyId],
          deleted: [],
          created: [paragraphId],
          dependencyKeys: storyDep,
        },
      };
    }
    case 'insertParagraph': {
      const { model: m, paragraphId } = insertParagraph(model, op.storyId, op.index, op.runs);
      return {
        model: m,
        effect: {
          dirty: [op.storyId],
          deleted: [],
          created: [paragraphId],
          dependencyKeys: storyDep,
        },
      };
    }
    case 'insertText': {
      const m = insertTextIntoParagraph(model, op.paragraphId, op.text, op.props);
      return {
        model: m,
        effect: { dirty: [op.paragraphId], deleted: [], created: [], dependencyKeys: storyDep },
      };
    }
    case 'splitParagraph': {
      const { model: m, tailId } = splitParagraph(model, op.paragraphId, op.offset);
      return {
        model: m,
        effect: {
          dirty: [op.paragraphId],
          deleted: [],
          created: [tailId],
          split: { from: op.paragraphId, tail: tailId },
          dependencyKeys: storyDep,
        },
      };
    }
    case 'joinParagraphs': {
      const m = joinParagraphs(model, op.firstId, op.secondId);
      return {
        model: m,
        effect: {
          dirty: [op.firstId],
          deleted: [op.secondId],
          created: [],
          join: { kept: op.firstId, removed: op.secondId },
          dependencyKeys: storyDep,
        },
      };
    }
    case 'moveBlock': {
      const movedId = (
        model.stories.get(op.storyId)?.blocks[op.fromIndex] as ParagraphRecord | undefined
      )?.id;
      const m = moveBlock(model, op.storyId, op.fromIndex, op.toIndex);
      return {
        model: m,
        effect: {
          dirty: movedId ? [movedId] : [],
          deleted: [],
          created: [],
          moves: movedId ? [{ id: movedId, from: op.fromIndex, to: op.toIndex }] : [],
          dependencyKeys: storyDep,
        },
      };
    }
    case 'replaceParagraph': {
      const { model: m, newId } = replaceParagraph(model, op.paragraphId, op.runs);
      return {
        model: m,
        effect: {
          dirty: [],
          deleted: [op.paragraphId],
          created: [newId],
          dependencyKeys: storyDep,
        },
      };
    }
    case 'setParagraphRuns': {
      const m = setParagraphRuns(model, op.paragraphId, op.runs);
      return {
        model: m,
        effect: { dirty: [op.paragraphId], deleted: [], created: [], dependencyKeys: storyDep },
      };
    }
    case 'deleteParagraph': {
      const { model: m } = deleteParagraph(model, op.paragraphId);
      return {
        model: m,
        effect: { dirty: [], deleted: [op.paragraphId], created: [], dependencyKeys: storyDep },
      };
    }
  }
  // Exhaustive; unreachable if validateDocOp gated the op.
  void indexOfBlock;
  throw new Error('unreachable');
}
