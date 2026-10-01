import type { DocxEditorRuntime } from '@docx-editor.dev/editor-api';
import { z } from 'zod';
import { commit, stateFor } from './document-access';

export const propertyNames = [
  'author',
  'title',
  'subject',
  'keywords',
  'comments',
  'category',
] as const;
export const readPropertiesSchema = z
  .object({
    properties: z.array(z.enum(propertyNames)).min(1).max(6),
  })
  .strict();
export const editPropertiesSchema = z
  .object({
    author: z.string().max(4096).optional(),
    title: z.string().max(4096).optional(),
    subject: z.string().max(4096).optional(),
    keywords: z.string().max(4096).optional(),
    comments: z.string().max(4096).optional(),
    category: z.string().max(4096).optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((item) => item !== undefined),
    'Provide at least one property.'
  );

export async function documentProperties(
  runtime: DocxEditorRuntime,
  input: unknown,
  read: boolean
) {
  if (read) {
    const { properties } = readPropertiesSchema.parse(input);
    return runtime.run(async (context) => {
      const target = context.document.properties;
      target.load(properties.join(','));
      await context.sync();
      return Object.fromEntries(properties.map((name) => [name, target[name]]));
    });
  }
  const values = editPropertiesSchema.parse(input);
  return runtime.run(async (context) => {
    const target = context.document.properties;
    for (const name of propertyNames) {
      const value = values[name];
      if (value !== undefined) target[name] = value;
    }
    await commit(context, stateFor(runtime), 'document properties');
    return {
      updated: Object.keys(values).filter(
        (name) => values[name as (typeof propertyNames)[number]] !== undefined
      ),
    };
  });
}
