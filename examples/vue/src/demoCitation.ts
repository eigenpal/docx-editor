import { z } from 'zod';
import { defineCustomNode } from '@docx-editor.dev/pro';

export const CitationData = z.object({
  sourceId: z.string().min(1),
  locator: z.string(),
  authors: z.array(z.string()).max(64),
  year: z.number().int().gte(0).lte(3000),
  url: z.url().optional(),
});

export type CitationData = z.infer<typeof CitationData>;

export const DEMO_CITATION = defineCustomNode({
  name: 'citation',
  tagPrefix: 'docx',
  label: 'Citation',
  chrome: { color: '#7c3aed' },
  schema: CitationData,
  text: (data) =>
    `(${data.authors[0] ?? 'Anon'} ${String(data.year)}${data.locator ? `, ${data.locator}` : ''})`,
  tagAttrs: (data) => ({ sourceId: data.sourceId }),
  preserveOnExport: 'text',
  reviewCard: ({ text, data }) => ({
    title: `Citation — ${data?.sourceId ?? 'unknown source'}`,
    detail: data
      ? `${data.authors.join(', ') || 'no authors'} (${String(data.year)})${data.locator ? `, ${data.locator}` : ''}`
      : text,
    icon: 'M300-80q-58 0-99-41t-41-99v-520q0-58 41-99t99-41h500v600q-25 0-42.5 17.5T740-220q0 25 17.5 42.5T800-160v80H300Zm-60-267q14-7 29-10t31-3h20v-440h-20q-25 0-42.5 17.5T240-740v393Zm160-13h320v-440H400v440Zm-160 13v-453 453Zm60 187h373q-6-14-9.5-28.5T660-220q0-16 3-31t10-29H300q-26 0-43 17.5T240-220q0 26 17 43t43 17Z',
  }),
});

export interface CitationFormState {
  at: import('@docx-editor.dev/vue').EditorCaret | null;
}

export const DEMO_CITATION_DEFAULTS: CitationData = {
  sourceId: 'demo-source',
  locator: 'p. 12',
  authors: ['Demo Author'],
  year: 2026,
};
