import { z } from 'zod';

export const text = z
  .string()
  .max(20000)
  .regex(/^[^\r\n\v\f\u2028\u2029]*$/, 'Use separate paragraphs for line breaks.');
export const nonemptyText = text.min(1);
export const index = z.number().int().min(0).max(100000);
export const target = z.object({ paragraphId: z.string().min(1), search: nonemptyText.optional() });
export const targets = z.array(target).min(1).max(40);
export const story = z
  .object({
    kind: z.enum(['body', 'header', 'footer']).default('body'),
    section: index.default(0),
    variant: z.enum(['Primary', 'FirstPage', 'EvenPages']).default('Primary'),
  })
  .default({ kind: 'body', section: 0, variant: 'Primary' });
export const scope = { story };
export const area = z.enum([
  'paragraphs',
  'tables',
  'controls',
  'lists',
  'comments',
  'revisions',
  'sections',
  'pictures',
  'fields',
]);
export const inspectSchema = z.object({
  ...scope,
  area: area.default('paragraphs'),
  offset: index.default(0),
  limit: z.number().int().min(1).max(40).default(40),
});
export const font = z
  .object({
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    strikeThrough: z.boolean().optional(),
    name: z.string().min(1).max(128).optional(),
    size: z.number().positive().max(1638).optional(),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    highlightColor: z
      .enum([
        'Yellow',
        'Lime',
        'Turquoise',
        'Pink',
        'Blue',
        'Red',
        'DarkBlue',
        'Teal',
        'Green',
        'Purple',
        'DarkRed',
        'Olive',
        'Gray',
        'LightGray',
        'Black',
        'White',
      ])
      .nullable()
      .optional(),
    underline: z
      .enum([
        'None',
        'Single',
        'Word',
        'Double',
        'Thick',
        'Dotted',
        'DottedHeavy',
        'DashLine',
        'DashLineHeavy',
        'DashLineLong',
        'DashLineLongHeavy',
        'DotDashLine',
        'DotDashLineHeavy',
        'TwoDotDashLine',
        'TwoDotDashLineHeavy',
        'Wave',
        'WaveHeavy',
        'WaveDouble',
      ])
      .optional(),
    subscript: z.boolean().optional(),
    superscript: z.boolean().optional(),
  })
  .strict();
export const paragraphFormat = z
  .object({
    style: z.string().min(1).max(128).optional(),
    alignment: z.enum(['Left', 'Centered', 'Right', 'Justified']).optional(),
    leftIndent: z.number().finite().optional(),
    rightIndent: z.number().finite().optional(),
    firstLineIndent: z.number().finite().optional(),
    lineSpacing: z
      .number()
      .positive()
      .describe(
        'Office.js line spacing: 12 means single, 18 means 1.5 lines, 24 means double for normal automatic spacing. Never pass a multiplier such as 1.15.'
      )
      .optional(),
    spaceBefore: z.number().finite().optional(),
    spaceAfter: z.number().finite().optional(),
  })
  .strict();
// Each change carries one property. Models must not invent defaults for unrelated properties.
function changesFor(shape: Record<string, z.ZodOptional<z.ZodType>>) {
  const variants = Object.entries(shape).map(([property, value]) =>
    z.object({ property: z.literal(property), value: value.unwrap() }).strict()
  );
  return z
    .array(
      z.union(
        variants as [
          (typeof variants)[number],
          (typeof variants)[number],
          ...(typeof variants)[number][],
        ]
      )
    )
    .min(1)
    .max(40)
    .refine(
      (changes) => new Set(changes.map((change) => change.property)).size === changes.length,
      'Specify each property once.'
    );
}
export const formatSchema = z.object({
  ...scope,
  targets,
  changes: changesFor({
    ...font.shape,
    ...paragraphFormat.shape,
    hyperlink: z.string().max(4096).optional(),
  }),
});
export const paragraphChanges = changesFor({ ...font.shape, ...paragraphFormat.shape });
export const textSchema = z.object({
  ...scope,
  edits: z
    .array(
      z.discriminatedUnion('action', [
        z.object({
          action: z.literal('insertText'),
          target,
          text: nonemptyText,
          font: font
            .optional()
            .describe(
              'Font properties for the inserted text, applied through the returned range in either editing mode.'
            ),
          location: z.enum(['Before', 'After', 'Replace', 'Start', 'End']),
        }),
        z.object({ action: z.literal('delete'), target }),
        z.object({
          action: z.literal('insertParagraph'),
          target,
          text,
          location: z.enum(['Before', 'After']),
          style: z.string().optional(),
          format: paragraphChanges
            .optional()
            .describe(
              'Formatting for the inserted paragraph, applied through its returned proxy. Works for new suggested paragraphs before acceptance.'
            ),
        }),
        z.object({ action: z.literal('deleteParagraph'), paragraphId: z.string().min(1) }),
      ])
    )
    .min(1)
    .max(40),
});
export const matrix = z
  .array(z.array(text).min(1).max(30))
  .min(1)
  .max(100)
  .refine(
    (rows) => rows.every((row) => row.length === rows[0]!.length),
    'Rows must have equal lengths.'
  );
export const tableSchema = z.object({
  ...scope,
  table: index,
  operation: z.discriminatedUnion('action', [
    z.object({ action: z.literal('values'), values: matrix }),
    z.object({
      action: z.literal('cell'),
      row: index,
      column: index,
      changes: changesFor({
        value: text.optional(),
        columnWidth: z.number().positive().optional(),
        shadingColor: z.string().optional(),
        verticalAlignment: z.enum(['Top', 'Center', 'Bottom']).optional(),
      }),
    }),
    z.object({
      action: z.literal('format'),
      changes: changesFor({
        style: z.string().optional(),
        headerRowCount: index.optional(),
      }),
    }),
    z.object({
      action: z.literal('addRows'),
      location: z.enum(['Start', 'End']),
      count: z.number().int().min(1).max(100),
      values: matrix.optional(),
    }),
    z.object({
      action: z.literal('addColumns'),
      location: z.enum(['Start', 'End']),
      count: z.number().int().min(1).max(30),
      values: matrix.optional(),
    }),
    z.object({ action: z.literal('deleteRows'), start: index, count: z.number().int().positive() }),
    z.object({
      action: z.literal('deleteColumns'),
      start: index,
      count: z.number().int().positive(),
    }),
    z.object({ action: z.literal('delete') }),
  ]),
});
export const listSchema = z.object({
  ...scope,
  paragraphIds: z.array(z.string().min(1)).min(1).max(40),
  operation: z.discriminatedUnion('action', [
    z.object({ action: z.literal('create'), kind: z.enum(['bullet', 'numbered']) }),
    z.object({ action: z.literal('attach'), listId: index, level: z.number().int().min(0).max(8) }),
    z.object({ action: z.literal('detach') }),
    z.object({ action: z.literal('level'), level: z.number().int().min(0).max(8) }),
  ]),
});
export const listLevelSchema = z.object({
  ...scope,
  list: index,
  level: z.number().int().min(0).max(8),
  operations: z
    .array(
      z.discriminatedUnion('action', [
        z.object({
          action: z.literal('bullet'),
          bullet: z.enum(['Custom', 'Solid', 'Hollow', 'Square', 'Diamonds', 'Arrow', 'Checkmark']),
          charCode: index.optional(),
          fontName: z.string().optional(),
        }),
        z.object({
          action: z.literal('numbering'),
          numbering: z.enum([
            'None',
            'Arabic',
            'UpperRoman',
            'LowerRoman',
            'UpperLetter',
            'LowerLetter',
          ]),
          formatString: z
            .array(z.union([z.string(), z.number().int().min(0).max(8)]))
            .max(20)
            .optional(),
        }),
        z.object({ action: z.literal('startingNumber'), value: index }),
        z.object({
          action: z.literal('indents'),
          textIndent: z.number().finite(),
          markerIndent: z.number().finite(),
        }),
      ])
    )
    .min(1)
    .max(4),
});
export const controlSchema = z.object({
  ...scope,
  control: index,
  operation: z.discriminatedUnion('action', [
    z.object({
      action: z.literal('insertText'),
      text,
      location: z.enum(['Replace', 'Start', 'End']),
    }),
    z.object({
      action: z.literal('properties'),
      changes: changesFor({
        tag: z.string().max(64).optional(),
        title: z.string().max(64).optional(),
        cannotEdit: z.boolean().optional(),
        cannotDelete: z.boolean().optional(),
      }),
    }),
    z.object({ action: z.literal('delete'), keepContent: z.boolean() }),
  ]),
});
export const reviewSchema = z.object({
  ...scope,
  operation: z.discriminatedUnion('action', [
    z.object({ action: z.literal('comment'), target, text: nonemptyText }),
    z.object({ action: z.literal('reply'), comment: index, text: nonemptyText }),
    z.object({ action: z.literal('resolveComment'), comment: index, resolved: z.boolean() }),
    z.object({ action: z.literal('deleteComment'), comment: index }),
    z.object({ action: z.literal('deleteReply'), comment: index, reply: index }),
    z.object({ action: z.literal('acceptRevision'), revision: index }),
    z.object({ action: z.literal('rejectRevision'), revision: index }),
    z.object({ action: z.literal('acceptAll') }),
    z.object({ action: z.literal('rejectAll') }),
  ]),
});
export const layoutSchema = z.object({
  section: index.default(0),
  changes: changesFor({
    orientation: z.enum(['Portrait', 'Landscape']).optional(),
    pageWidth: z.number().positive().optional(),
    pageHeight: z.number().positive().optional(),
    leftMargin: z.number().nonnegative().optional(),
    rightMargin: z.number().nonnegative().optional(),
    topMargin: z.number().nonnegative().optional(),
    bottomMargin: z.number().nonnegative().optional(),
  }),
});
export const breakSchema = z.object({
  ...scope,
  target,
  type: z.enum(['Page', 'SectionNext']),
  location: z.enum(['Before', 'After']),
});
export const pictureSchema = z.object({
  ...scope,
  operation: z.discriminatedUnion('action', [
    z.object({
      action: z.literal('insert'),
      target,
      base64: z
        .string()
        .min(1)
        .max(4 * 1024 * 1024),
      location: z.enum(['Before', 'After', 'Replace', 'Start', 'End']),
    }),
    z.object({
      action: z.literal('format'),
      picture: index,
      changes: changesFor({
        width: z.number().positive().optional(),
        height: z.number().positive().optional(),
        lockAspectRatio: z.boolean().optional(),
        altTextDescription: z.string().max(4096).optional(),
      }),
    }),
    z.object({ action: z.literal('delete'), picture: index }),
  ]),
});
export const fieldSchema = z.object({
  ...scope,
  operation: z.discriminatedUnion('action', [
    z.object({
      action: z.literal('insert'),
      target,
      type: z.enum(['Page', 'NumPages']),
      location: z.enum(['Before', 'After', 'Replace', 'Start', 'End']),
    }),
    z.object({ action: z.literal('code'), field: index, code: z.enum(['PAGE', 'NUMPAGES']) }),
    z.object({ action: z.literal('updateResult'), field: index }),
    z.object({ action: z.literal('delete'), field: index }),
  ]),
});
export type Story = z.infer<typeof story>;
export type Target = z.infer<typeof target>;
