import { tool } from 'ai';
import { z } from 'zod';
import * as editing from './editing-schemas';

const paragraphId = z
  .string()
  .min(1)
  .describe(
    'Copy the paragraph target from the latest read or inspection. Reinspect temporary @writer: targets after an edit.'
  );
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

export const inlineRun = z.object({
  text: editing.nonemptyText,
  font: editing.font.optional(),
});

const blockSchema = z.union([
  z
    .object({
      kind: z.literal('paragraph').default('paragraph'),
      text: editing.text,
      runs: z
        .array(inlineRun)
        .min(1)
        .max(40)
        .optional()
        .describe(
          'Ordered inline text runs with optional font properties. Their text must concatenate to text. Use for mixed bold, italic, underline, or other character formatting, including repeated phrases.'
        ),
      style: z
        .enum(['Title', 'Subtitle', 'Heading 1', 'Heading 2', 'Quote', 'Normal'])
        .default('Normal'),
      format: editing.paragraphChanges
        .optional()
        .describe(
          'Explicit font and paragraph properties for this block, applied through public APIs. Use alignment=Centered for a centered title and alignment=Justified for justified body text.'
        ),
    })
    .refine(
      (block) => !block.runs || block.runs.map((run) => run.text).join('') === block.text,
      'Inline run text must concatenate to paragraph text.'
    ),
  z.object({
    kind: z.literal('list'),
    listType: z.enum(['bullet', 'numbered']),
    items: z.array(editing.nonemptyText).min(1).max(100),
    format: editing.paragraphChanges.optional(),
  }),
  z
    .object({
      kind: z.literal('table'),
      rows: editing.matrix,
      headerRowCount: z.number().int().min(0).max(100).default(1),
      headerFont: editing.font.optional(),
    })
    .refine((value) => value.headerRowCount <= value.rows.length, 'Header rows exceed table rows.'),
]);

export function hasEnoughBrief(value: unknown): boolean {
  return briefSchema.safeParse(value).success;
}

export const createDocumentSchema = z.object({
  brief: briefSchema,
  title: z.string().min(2),
  blocks: z.array(blockSchema).min(1).max(200),
});

export const formatListsSchema = z.object({
  items: z
    .array(
      z.object({
        paragraphId,
        kind: z.enum(['bullet', 'numbered']),
      })
    )
    .min(1),
});

export const insertTableSchema = z.object({
  ...editing.scope,
  location: z.enum(['Before', 'After']).default('Before'),
  beforeParagraphId: paragraphId,
  rows: z
    .array(z.array(editing.text).min(1).max(6))
    .min(1)
    .max(30)
    .refine((rows) => rows.every((row) => row.length === rows[0]?.length), {
      message: 'Every table row must have the same number of cells.',
    }),
});

export const insertContentControlsSchema = z.object({
  ...editing.scope,
  fields: z
    .array(
      z.object({
        paragraphId,
        search: exactPhrase.describe(
          'Exact field placeholder to wrap. Keep the label outside the control when possible.'
        ),
        type: z.enum(['PlainText', 'RichText', 'DatePicker']).default('PlainText'),
        tag: z.string().min(1).max(64),
        title: z.string().min(1).max(64),
      })
    )
    .min(1),
});

export const writeHeaderFooterSchema = z.object({
  header: z.string().min(1),
  footerPrefix: z.string().min(1).default('Page '),
});

export const WRITER_TOOLS = {
  write_story: tool({
    description:
      'Insert or replace plain text in a body, header, or footer. Use Replace only for an explicit complete-story rewrite. This creates an absent header or footer. Other content remains unchanged.',
    inputSchema: z.object({
      ...editing.scope,
      text: editing.text,
      location: z.enum(['Start', 'End', 'Replace']),
    }),
  }),
  inspect_document: tool({
    description:
      'Inspect one document area with explicit formatting and object indexes. Read again after editing or a stale-target error. Indexes are valid only for this inspected document state. Empty paragraphs remain visible.',
    inputSchema: editing.inspectSchema,
  }),
  discover_capabilities: tool({
    description:
      'Read tool coverage, host limits, and unsupported operations before planning an unfamiliar edit.',
    inputSchema: z.object({}),
  }),
  format_document: tool({
    description:
      'Apply explicit property/value changes to exact targets. Include only requested font, paragraph, or hyperlink properties. Batch independent targets. Font and paragraph changes support suggestion mode. Hyperlinks require direct edits. Never insert Markdown to simulate formatting.',
    inputSchema: editing.formatSchema,
  }),
  edit_text: tool({
    description:
      'Insert, replace, or delete text and paragraphs using the selected editing mode. Read targets first. Batch independent edits; overlapping edits can refuse. Text is literal, not Markdown or HTML. For inserted text, set font to format the returned range. For inserted paragraphs, set format to apply font and paragraph properties through the returned proxy, including in Suggestions.',
    inputSchema: editing.textSchema,
  }),
  edit_table: tool({
    description:
      'Edit an inspected table: values, cell properties, style, header rows, rows, or columns. One structural operation per call. Complete table insertion, table value replacement, row additions, and partial row deletions support native revisions. An author can configure a complete proposed table while it has no foreign revisions. Existing table properties and columns require direct edits. Tracked table value replacement and ranges across paragraphs refuse in collaboration. Merged and protected structures can refuse.',
    inputSchema: editing.tableSchema,
  }),
  edit_list: tool({
    description:
      'Create, join, remove, or change the level of a list for inspected paragraphs. Preserves paragraph text. One-item lists are valid. Suggestion mode records native paragraph-property revisions.',
    inputSchema: editing.listSchema,
  }),
  configure_list: tool({
    description:
      'Configure an inspected list level: bullets, numbering, starting number, or indents in points. In suggestion mode, only a newly proposed list definition can change.',
    inputSchema: editing.listLevelSchema,
  }),
  edit_control: tool({
    description:
      'Edit an inspected SDT content control: text, tag, title, locks, or deletion. Text insertion supports text-like controls; date and other typed controls require their native value UI. keepContent preserves text when removing a wrapper. Do not unlock protected fields unless requested.',
    inputSchema: editing.controlSchema,
  }),
  edit_review: tool({
    description:
      'Create comments, reply, resolve, delete comments or replies, and accept or reject inspected revisions. Revision decisions require an explicit user request.',
    inputSchema: editing.reviewSchema,
  }),
  edit_layout: tool({
    description:
      'Change an inspected section page size, orientation, or margins in points. Requires direct editing mode.',
    inputSchema: editing.layoutSchema,
  }),
  insert_break: tool({
    description:
      'Insert a page or next-page section break at an inspected paragraph. Requires direct editing mode.',
    inputSchema: editing.breakSchema,
  }),
  edit_picture: tool({
    description:
      'Insert a supplied PNG/JPEG base64 image or change an inspected image size, aspect ratio, alt text, or delete it. Never invent image bytes.',
    inputSchema: editing.pictureSchema,
  }),
  edit_field: tool({
    description:
      'Insert, change, calculate, or delete PAGE/NUMPAGES fields. Server calculation requires a pagination measurer. You can insert an inert TOC field with supported switches; TOC calculation and code changes refuse.',
    inputSchema: editing.fieldSchema,
  }),
  read_document: tool({
    description:
      'Read main-body paragraphs and IDs. Original view includes pending deletions and hides pending insertions. Use inspect_document for formatting and objects.',
    inputSchema: z.object({
      offset: editing.index.default(0),
      limit: z.number().int().min(1).max(40).default(40),
    }),
  }),
  create_document: tool({
    description:
      'Replace the complete body with structured paragraph, list, and table blocks only for a requested new draft or complete rewrite. Paragraph and list blocks accept format property/value changes for explicit fonts, sizes, alignment, and spacing. Paragraph runs support mixed inline fonts. Suggestions can replace an eligible paragraph-only body; existing tables, wrappers, or revisions can refuse. Tables use kind=table, rows, and optional headerFont. Never simulate a table with pipe-separated text. Use only relevant structure. Completed stages remain if later stages fail.',
    inputSchema: createDocumentSchema,
  }),
  format_lists: tool({
    description:
      'Format selected paragraphs as bullets or numbering. One item and either kind are supported. Read targets first.',
    inputSchema: formatListsSchema,
  }),
  insert_table: tool({
    description:
      'Insert and populate a meaningful table before a paragraph. Read the anchor first. One row and one column are supported. Both editing modes support complete table insertion.',
    inputSchema: insertTableSchema,
  }),
  insert_content_controls: tool({
    description:
      'Create actual SDT (structured document tag) content controls around existing field text. Preserve labels and headings. PlainText, RichText, and DatePicker support direct edits and Suggestions. Suggestions require nonempty ordinary text without existing review markup, outside collaboration. Choose DatePicker for calendar dates. Dropdown and combo-box creation remain unsupported. Each field commits separately.',
    inputSchema: insertContentControlsSchema,
  }),
  write_header_footer: tool({
    description: 'Write the document header, footer prefix, and Page X of Y field.',
    inputSchema: writeHeaderFooterSchema,
  }),
} as const;

const LABELS: Record<string, string> = {
  read_document: 'Reading the document',
  create_document: 'Writing styled paragraphs',
  format_lists: 'Formatting lists',
  insert_table: 'Inserting and filling a table',
  insert_content_controls: 'Adding content controls',
  write_header_footer: 'Writing the header and footer',
};

export function toolLabel(name: string): string {
  return LABELS[name] ?? name.replace(/_/g, ' ');
}
