/**
 * Paged-document tools — read content scoped to one or more rendered pages.
 *
 * Word's JS API doesn't model pages as first-class addressable units. We do
 * because the editor is paged. Backed by the layout-painter's page boundary
 * state in the live editor; the headless reviewer reports zero pages.
 */

import type { AgentToolDefinition } from './types';

export const readPage: AgentToolDefinition<{ pageNumber: number }> = {
  name: 'read_page',
  displayName: 'Reading page',
  description:
    'Read the contents of one rendered page (1-indexed). Returns paragraphs ' +
    'on the page, each tagged with its stable paraId. Use this when the user ' +
    'asks "summarize page 3" or "comment on what\'s on this page".',
  inputSchema: {
    type: 'object',
    properties: {
      pageNumber: { type: 'number', description: '1-indexed page number.' },
    },
    required: ['pageNumber'],
  },
  handler: (input, bridge) => {
    const page = bridge.getPage(input.pageNumber);
    if (!page) {
      const total = bridge.getTotalPages();
      if (total === 0) {
        return { success: false, error: 'No pages rendered (headless mode or empty document).' };
      }
      return {
        success: false,
        error: `Page ${input.pageNumber} does not exist (document has ${total} page${total === 1 ? '' : 's'}).`,
      };
    }
    return { success: true, data: page.text || '(empty page)' };
  },
};

export const readPages: AgentToolDefinition<{ from: number; to: number }> = {
  name: 'read_pages',
  displayName: 'Reading pages',
  description:
    'Read a contiguous range of rendered pages (1-indexed, inclusive). ' +
    'Returns paragraphs across the range, each tagged with paraId. Cheaper ' +
    'than calling read_page repeatedly — single round-trip.',
  inputSchema: {
    type: 'object',
    properties: {
      from: { type: 'number', description: '1-indexed start page (inclusive).' },
      to: { type: 'number', description: '1-indexed end page (inclusive).' },
    },
    required: ['from', 'to'],
  },
  handler: (input, bridge) => {
    const pages = bridge.getPages({ from: input.from, to: input.to });
    if (pages.length === 0) {
      const total = bridge.getTotalPages();
      if (total === 0) {
        return { success: false, error: 'No pages rendered (headless mode or empty document).' };
      }
      return {
        success: false,
        error: `No pages in range ${input.from}–${input.to} (document has ${total} page${total === 1 ? '' : 's'}).`,
      };
    }
    const text = pages
      .map((p) => `--- Page ${p.pageNumber} ---\n${p.text || '(empty page)'}`)
      .join('\n\n');
    return { success: true, data: text };
  },
};
