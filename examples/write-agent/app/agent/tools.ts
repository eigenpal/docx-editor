import { tool } from 'ai';
import { z } from 'zod';

const paragraphId = z.string().min(1).describe('The stable paragraph id from read_document.');
const exactPhrase = z
  .string()
  .min(1)
  .describe('An exact, case-sensitive phrase copied from the current document.');

export const briefSchema = z.object({
  documentType: z.string().min(2),
  partiesOrAudience: z.string().min(2),
  purpose: z.string().min(2),
  jurisdictionOrDomainRules: z.string().min(2),
  tone: z.string().min(2),
  length: z.string().min(2),
});

const blockSchema = z.object({
  text: z.string().min(1),
  style: z
    .enum(['Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Quote', 'Normal'])
    .default('Normal'),
});

export function hasEnoughBrief(value: unknown): boolean {
  return briefSchema.safeParse(value).success;
}

export const createDocumentSchema = z.object({
  brief: briefSchema,
  title: z.string().min(2),
  blocks: z.array(blockSchema).min(8).max(200),
});

export const formatListsSchema = z.object({
  items: z
    .array(
      z.object({
        paragraphId,
        kind: z.enum(['bullet', 'numbered']),
      })
    )
    .min(4),
});

export const insertTableSchema = z.object({
  beforeParagraphId: paragraphId,
  rows: z
    .array(z.array(z.string().min(1)).min(2).max(6))
    .min(2)
    .max(8)
    .refine((rows) => rows.every((row) => row.length === rows[0]?.length), {
      message: 'Every table row must have the same number of cells.',
    }),
});

export const insertContentControlsSchema = z.object({
  fields: z
    .array(
      z.object({
        paragraphId,
        tag: z.string().min(1).max(64),
        title: z.string().min(1).max(64),
      })
    )
    .min(2),
});

export const writeHeaderFooterSchema = z.object({
  header: z.string().min(1),
  footerPrefix: z.string().min(1).default('Page '),
});

export const WRITER_TOOLS = {
  read_document: tool({
    description:
      'Read the current document as the reader sees it. Returns stable paragraph ids and text.',
    inputSchema: z.object({}),
  }),
  create_document: tool({
    description:
      'Replace the complete seed with styled paragraphs. This starts the required multi-tool document build.',
    inputSchema: createDocumentSchema,
  }),
  format_lists: tool({
    description:
      'Format at least two adjacent paragraphs as bullets and two adjacent paragraphs as numbering.',
    inputSchema: formatListsSchema,
  }),
  insert_table: tool({
    description:
      'Insert and populate a meaningful table before a paragraph. Use at least two rows and two columns.',
    inputSchema: insertTableSchema,
  }),
  insert_content_controls: tool({
    description:
      'Wrap at least two generic fillable paragraphs in tagged plain-text content controls.',
    inputSchema: insertContentControlsSchema,
  }),
  write_header_footer: tool({
    description: 'Write the document header, footer prefix, and Page X of Y field.',
    inputSchema: writeHeaderFooterSchema,
  }),
  propose_replacement: tool({
    description: 'Suggest a tracked replacement for one exact phrase in one paragraph.',
    inputSchema: z.object({
      paragraphId,
      search: exactPhrase,
      // Matching the engine gate: non-empty, and no paragraph-breaking characters —
      // an empty replacement is a proposeDeletion, and a newline is not a paragraph mark.
      replaceWith: z
        .string()
        .min(1)
        .regex(/^[^\r\n\v\f\u2028\u2029]*$/, 'one paragraph of text, no line breaks'),
    }),
  }),
  propose_insertion: tool({
    description: 'Suggest tracked text immediately after one exact phrase in one paragraph.',
    inputSchema: z.object({
      paragraphId,
      after: exactPhrase,
      text: z
        .string()
        .min(1)
        .regex(/^[^\r\n\v\f\u2028\u2029]*$/, 'one paragraph of text, no line breaks'),
    }),
  }),
  propose_deletion: tool({
    description: 'Suggest a tracked deletion of one exact phrase in one paragraph.',
    inputSchema: z.object({
      paragraphId,
      search: exactPhrase,
    }),
  }),
} as const;

const LABELS: Record<string, string> = {
  read_document: 'Reading the document',
  create_document: 'Writing styled paragraphs',
  format_lists: 'Formatting lists',
  insert_table: 'Inserting and filling a table',
  insert_content_controls: 'Adding content controls',
  write_header_footer: 'Writing the header and footer',
  propose_replacement: 'Suggesting a replacement',
  propose_insertion: 'Suggesting an insertion',
  propose_deletion: 'Suggesting a deletion',
};

export function toolLabel(name: string): string {
  return LABELS[name] ?? name.replace(/_/g, ' ');
}
