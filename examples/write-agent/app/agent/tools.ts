import { tool } from 'ai';
import { z } from 'zod';

const paragraphId = z.string().min(1).describe('The stable paragraph id from read_document.');
const exactPhrase = z
  .string()
  .min(1)
  .describe('An exact, case-sensitive phrase copied from the vanilla document.');

export const briefSchema = z.object({
  documentType: z.string().min(2),
  partiesOrAudience: z.string().min(2),
  purpose: z.string().min(2),
  jurisdictionOrDomainRules: z.string().min(2),
  tone: z.string().min(2),
  length: z.string().min(2),
});

const blockSchema = z.object({
  text: z.string(),
  style: z.enum(['Title', 'Heading 1', 'Normal']).default('Normal'),
  list: z.enum(['none', 'bullet', 'numbered']).default('none'),
  contentControl: z.boolean().default(false),
});

export function hasEnoughBrief(value: unknown): boolean {
  return briefSchema.safeParse(value).success;
}

export const createDocumentSchema = z.object({
  brief: briefSchema,
  title: z.string().min(2),
  blocks: z.array(blockSchema).min(3).max(200),
});

export const WRITER_TOOLS = {
  read_document: tool({
    description:
      'Read the current document through the vanilla revision projection. Returns stable paragraph ids and text.',
    inputSchema: z.object({}),
  }),
  create_document: tool({
    description:
      'Replace the complete seeded body with a fresh structured draft. Call only after all six interview fields are known.',
    inputSchema: createDocumentSchema,
  }),
  propose_replacement: tool({
    description: 'Suggest a tracked replacement for one exact phrase in one paragraph.',
    inputSchema: z.object({
      paragraphId,
      search: exactPhrase,
      replaceWith: z.string(),
    }),
  }),
  propose_insertion: tool({
    description: 'Suggest tracked text immediately after one exact phrase in one paragraph.',
    inputSchema: z.object({
      paragraphId,
      after: exactPhrase,
      text: z.string().min(1),
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
  read_document: 'Reading the vanilla document',
  create_document: 'Creating the fresh document',
  propose_replacement: 'Suggesting a replacement',
  propose_insertion: 'Suggesting an insertion',
  propose_deletion: 'Suggesting a deletion',
};

export function toolLabel(name: string): string {
  return LABELS[name] ?? name.replace(/_/g, ' ');
}
