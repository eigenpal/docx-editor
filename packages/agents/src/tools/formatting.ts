/**
 * Formatting tools — character formatting and paragraph styles.
 *
 * Mirrors Word JS API `Range.font.*` and `ParagraphFormat.style`. Both verbs
 * are direct edits (not tracked changes). The agent locates first
 * (`read_document` / `find_text`), then mutates by paraId + optional search.
 */

import type { AgentToolDefinition } from './types';
import type { CharacterFormatting } from '../types';

/**
 * Closed enum from ECMA-376 §17.3.2.40 (`ST_Underline`) and Word's
 * `Word.UnderlineType`. Anything outside this set is rejected — Word
 * silently discards `<w:u w:val="squiggly"/>` and similar.
 */
const UNDERLINE_STYLES = [
  'single',
  'words',
  'double',
  'thick',
  'dotted',
  'dottedHeavy',
  'dash',
  'dashedHeavy',
  'dashLong',
  'dashLongHeavy',
  'dotDash',
  'dashDotHeavy',
  'dotDotDash',
  'dashDotDotHeavy',
  'wave',
  'wavyHeavy',
  'wavyDouble',
  'none',
] as const;

/**
 * Closed enum from ECMA-376 §17.3.2.15 (`ST_HighlightColor`) and Word's
 * `Word.HighlightColor`. Word does NOT accept arbitrary hex for
 * `<w:highlight>` — that's `<w:shd>` (background shading) territory.
 */
const HIGHLIGHT_COLORS = [
  'black',
  'blue',
  'cyan',
  'darkBlue',
  'darkCyan',
  'darkGray',
  'darkGreen',
  'darkMagenta',
  'darkRed',
  'darkYellow',
  'green',
  'lightGray',
  'magenta',
  'red',
  'white',
  'yellow',
  'none',
] as const;

export const applyFormatting: AgentToolDefinition<{
  paraId: string;
  search?: string;
  marks: CharacterFormatting;
}> = {
  name: 'apply_formatting',
  displayName: 'Applying formatting',
  description:
    'Apply character formatting (bold, italic, underline, strike, color, ' +
    'highlight, font size, font family) to a paragraph or to a unique phrase ' +
    'within it. Pass `search` to scope the change to part of the paragraph; ' +
    'omit it to format the whole paragraph. Direct edit — does not create a ' +
    'tracked change. Pass `false` to clear a mark; omit a key to leave it ' +
    'untouched. Color uses `{rgb: "FF0000"}` (no hash) or `{themeColor: "accent1"}`. ' +
    'Font size is in points. Font family takes `{ascii, hAnsi}`.',
  inputSchema: {
    type: 'object',
    properties: {
      paraId: { type: 'string', description: 'Paragraph id from read_document / find_text.' },
      search: {
        type: 'string',
        description:
          'Optional: format only this exact phrase within the paragraph (must be unique).',
      },
      marks: {
        type: 'object',
        description: 'Marks to set or clear. Omit a key to leave it untouched.',
        properties: {
          bold: { type: 'boolean' },
          italic: { type: 'boolean' },
          underline: {
            description:
              'true → single underline; false → clear; or { style: "single"|"double"|"thick"|"dotted"|"dottedHeavy"|"dash"|"dashedHeavy"|"dashLong"|"dashLongHeavy"|"dotDash"|"dashDotHeavy"|"dotDotDash"|"dashDotDotHeavy"|"wave"|"wavyHeavy"|"wavyDouble"|"words"|"none" }. Other values are rejected.',
          },
          strike: { type: 'boolean' },
          color: {
            type: 'object',
            description: 'Either {rgb: "RRGGBB"} (no hash) or {themeColor: "accent1"|"text1"|...}.',
            properties: {
              rgb: { type: 'string' },
              themeColor: { type: 'string' },
            },
          },
          highlight: {
            type: 'string',
            enum: [...HIGHLIGHT_COLORS],
            description:
              'Highlight color — must be one of the Word-supported names: ' +
              HIGHLIGHT_COLORS.join(', ') +
              '. Pass "none" to clear. Hex values are rejected (Word does not accept hex for <w:highlight>).',
          },
          fontSize: { type: 'number', description: 'Size in points (e.g. 12, 14, 24).' },
          fontFamily: {
            type: 'object',
            properties: {
              ascii: { type: 'string' },
              hAnsi: { type: 'string' },
            },
          },
        },
      },
    },
    required: ['paraId', 'marks'],
  },
  handler: (input, bridge) => {
    if (!input.marks || Object.keys(input.marks).length === 0) {
      return {
        success: false,
        error: 'No marks provided. Specify at least one of bold/italic/etc.',
      };
    }

    // Reject out-of-spec values early with a helpful error so the agent
    // can self-correct, instead of silently writing OOXML Word rejects
    // (`<w:u w:val="squiggly"/>` or `<w:highlight w:val="#FF8800"/>`).
    const underlineStyle =
      typeof input.marks.underline === 'object' && input.marks.underline !== null
        ? input.marks.underline.style
        : undefined;
    if (underlineStyle && !(UNDERLINE_STYLES as readonly string[]).includes(underlineStyle)) {
      return {
        success: false,
        error: `Invalid underline.style "${underlineStyle}". Must be one of: ${UNDERLINE_STYLES.join(', ')}.`,
      };
    }
    const highlight = typeof input.marks.highlight === 'string' ? input.marks.highlight : undefined;
    if (highlight && !(HIGHLIGHT_COLORS as readonly string[]).includes(highlight)) {
      return {
        success: false,
        error: `Invalid highlight "${highlight}". Must be one of: ${HIGHLIGHT_COLORS.join(', ')}. Hex values are not supported by Word's highlight attribute.`,
      };
    }

    // 'none' is the OOXML clear sentinel; the bridge treats falsy highlight as
    // removeMark, so map both to an empty string before dispatching.
    const marks = highlight === 'none' ? { ...input.marks, highlight: '' } : input.marks;

    const ok = bridge.applyFormatting({
      paraId: input.paraId,
      search: input.search,
      marks,
    });
    if (!ok) {
      return {
        success: false,
        error:
          'Could not apply formatting. The paraId may not exist, or `search` is missing / ambiguous.',
      };
    }
    const scope = input.search ? `"${input.search}" in ${input.paraId}` : input.paraId;
    return { success: true, data: `Formatting applied to ${scope}.` };
  },
};

export const setParagraphStyle: AgentToolDefinition<{
  paraId: string;
  styleId: string;
}> = {
  name: 'set_paragraph_style',
  displayName: 'Setting paragraph style',
  description:
    'Apply a paragraph style by id (e.g. "Heading1", "Heading2", "Title", ' +
    '"Quote", "Normal"). The styleId must exist in the document\'s style ' +
    'definitions — unknown ids are no-ops. Direct edit, not a tracked change.',
  inputSchema: {
    type: 'object',
    properties: {
      paraId: { type: 'string', description: 'Paragraph id from read_document / find_text.' },
      styleId: {
        type: 'string',
        description: 'Style id (e.g. "Heading1", "Title", "Quote", "Normal").',
      },
    },
    required: ['paraId', 'styleId'],
  },
  handler: (input, bridge) => {
    const ok = bridge.setParagraphStyle({ paraId: input.paraId, styleId: input.styleId });
    if (!ok) {
      return {
        success: false,
        error: `Could not set style. paraId "${input.paraId}" not found, or styleId "${input.styleId}" is not defined.`,
      };
    }
    return { success: true, data: `Style "${input.styleId}" applied to ${input.paraId}.` };
  },
};
