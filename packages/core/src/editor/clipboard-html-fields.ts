// Word's field structure in clipboard HTML.
//
// Word writes a field as conditional comments around its result: `<!--[if supportFields]>`
// holds a `field-begin` marker span, the instruction text and a `field-separator` marker, and a
// later comment holds the `field-end` marker. A browser keeps those comments as inert Comment
// nodes, and the result between them is ordinary HTML. Reading the markers back gives the
// pasted content its fields again: a table of contents stays a TOC field that can be updated,
// and its page numbers stay PAGEREF fields.
//
// SECURITY: the comment text is clipboard-supplied. It is scanned with a bounded tokenizer and
// never parsed as markup or executed; instruction text is escaped into `w:instrText`, and field
// instructions stay inert in the engine. Comment size, marker count and instruction length are
// capped. Markers that do not nest into complete fields are all dropped, so the result text
// stays and no half field reaches the document.

import { escapeXml } from '../store/package/sinks.ts';

/** A Word field comment longer than this is not field markup; it is ignored. */
const MAX_FIELD_COMMENT_LENGTH = 16_384;
/** Instruction text past this length is not a field instruction Word writes. */
const MAX_INSTRUCTION_LENGTH = 2_048;
/** Field markers one paste may carry. */
const MAX_FIELD_MARKERS = 30_000;

const BEGIN = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>';
const SEPARATE = '<w:r><w:fldChar w:fldCharType="separate"/></w:r>';
const END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
const INSTRUCTION = /<w:r><w:instrText xml:space="preserve">[^<]*<\/w:instrText><\/w:r>/g;
const MARKER = /<w:r><w:fldChar w:fldCharType="(begin|separate|end)"\/><\/w:r>/g;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z]{2,8});/g, (whole, body) => {
    const name = String(body);
    if (name.startsWith('#')) {
      const code = name[1] === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      const valid =
        Number.isInteger(code) &&
        code >= 0x20 &&
        code <= 0x10ffff &&
        !(code >= 0xd800 && code <= 0xdfff);
      return valid ? String.fromCodePoint(code) : '';
    }
    return Object.hasOwn(ENTITIES, name) ? ENTITIES[name]! : whole;
  });
}

function instructionRun(text: string): string {
  const instruction = decodeEntities(text).replace(/[\t\r\n\f\v ]+/g, ' ');
  if (instruction.trim() === '') return '';
  return `<w:r><w:instrText xml:space="preserve">${escapeXml(instruction)}</w:instrText></w:r>`;
}

/** Markers left per paste, keyed by the paste's projection. */
const markersLeft = new WeakMap<object, number>();

/**
 * The field runs one Word `supportFields` comment stands for, in order. Empty for any other
 * comment, or when the comment is outside the bounds.
 */
export function wordFieldRuns(comment: string, paste: object): string[] {
  if (!comment.startsWith('[if supportFields]>') || comment.length > MAX_FIELD_COMMENT_LENGTH)
    return [];
  const body = comment.slice('[if supportFields]>'.length).replace(/<!\[endif\]\s*$/, '');
  const runs: string[] = [];
  let instruction = '';
  let instructionOpen = false;
  const flush = (): boolean => {
    if (instruction.length > MAX_INSTRUCTION_LENGTH) return false;
    const run = instructionOpen ? instructionRun(instruction) : '';
    if (run) runs.push(run);
    instruction = '';
    return true;
  };
  // Tags and text alternate; neither class can match the other, so the scan is linear.
  for (const match of body.matchAll(/<([^<>]{0,1024})>|([^<]+)/g)) {
    if (match[2] !== undefined) {
      if (instructionOpen) instruction += match[2];
      if (instruction.length > MAX_INSTRUCTION_LENGTH) return [];
      continue;
    }
    const marker = /mso-element:\s*field-(begin|separator|end)/i.exec(match[1]!)?.[1];
    if (!marker) continue;
    if (!flush()) return [];
    const left = markersLeft.get(paste) ?? MAX_FIELD_MARKERS;
    if (left <= 0) return [];
    markersLeft.set(paste, left - 1);
    const kind = marker.toLowerCase();
    runs.push(kind === 'begin' ? BEGIN : kind === 'separator' ? SEPARATE : END);
    instructionOpen = kind === 'begin';
  }
  if (!flush()) return [];
  return runs;
}

/**
 * The blocks unchanged when every field marker nests into complete fields, or with every field
 * marker and instruction removed when any does not: a selection that starts or ends inside a
 * field carries half of it, and only the result text can be kept.
 */
export function withCompleteFields(blocks: readonly string[]): readonly string[] {
  const xml = blocks.join('');
  if (!xml.includes('w:fldCharType=')) return blocks;
  // Each open field: whether its separator has been seen.
  const open: boolean[] = [];
  let valid = true;
  for (const match of xml.matchAll(MARKER)) {
    const kind = match[1];
    if (kind === 'begin') open.push(false);
    else if (kind === 'separate') {
      if (open.length === 0 || open[open.length - 1]) valid = false;
      else open[open.length - 1] = true;
    } else if (open.pop() === undefined) valid = false;
    if (!valid) break;
  }
  if (valid && open.length === 0) return blocks;
  return blocks.map((block) => block.replace(MARKER, '').replace(INSTRUCTION, ''));
}
