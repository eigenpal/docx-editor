/**
 * Break tools — insert page and section breaks.
 *
 * Like the formatting verbs, this is a direct edit (not a tracked change). The
 * agent locates a paragraph first (`read_document` / `find_text`), then inserts
 * the break after it by paraId.
 */

import type { AgentToolDefinition } from './types';
import type { BreakType } from '../types';

/** Closed set of break kinds the editor can insert. */
const BREAK_TYPES = ['page', 'sectionNextPage', 'sectionContinuous'] as const;

const BREAK_LABELS: Record<BreakType, string> = {
  page: 'Page break',
  sectionNextPage: 'Section break (next page)',
  sectionContinuous: 'Section break (continuous)',
};

export const insertBreak: AgentToolDefinition<{
  paraId: string;
  type: BreakType;
}> = {
  name: 'insert_break',
  displayName: 'Inserting break',
  description:
    'Insert a break after a paragraph (located by paraId). ' +
    '`type: "page"` adds a page break so following content starts on a new page. ' +
    '`type: "sectionNextPage"` starts a new document section on a new page. ' +
    '`type: "sectionContinuous"` starts a new section on the same page (use this ' +
    'to change column layout or margins from that point onward). The target ' +
    'paragraph becomes the end of its page/section and the next paragraph begins ' +
    'the new one. Direct edit — not a tracked change.',
  inputSchema: {
    type: 'object',
    properties: {
      paraId: {
        type: 'string',
        description:
          'Paragraph id from read_document / find_text. The break is inserted after this paragraph.',
      },
      type: {
        type: 'string',
        enum: [...BREAK_TYPES],
        description:
          'Break kind: "page" (page break), "sectionNextPage" (new section, new page), ' +
          'or "sectionContinuous" (new section, same page).',
      },
    },
    required: ['paraId', 'type'],
  },
  handler: (input, bridge) => {
    if (!(BREAK_TYPES as readonly string[]).includes(input.type)) {
      return {
        success: false,
        error: `Invalid break type "${input.type}". Must be one of: ${BREAK_TYPES.join(', ')}.`,
      };
    }
    const ok = bridge.insertBreak({ paraId: input.paraId, type: input.type });
    if (!ok) {
      return {
        success: false,
        error: `Could not insert break. paraId "${input.paraId}" not found.`,
      };
    }
    return { success: true, data: `${BREAK_LABELS[input.type]} inserted after ${input.paraId}.` };
  },
};
