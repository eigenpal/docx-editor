/**
 * Strikethrough Mark Extension
 */

import { createMarkExtension } from '../create';
import { toggleMarkWithStoredMarks } from './markUtils';
import type { ExtensionContext, ExtensionRuntime } from '../types';

export const StrikeExtension = createMarkExtension({
  name: 'strike',
  schemaMarkName: 'strike',
  markSpec: {
    attrs: {
      double: { default: false },
    },
    parseDOM: [
      { tag: 's' },
      { tag: 'strike' },
      { tag: 'del' },
      {
        style: 'text-decoration',
        getAttrs: (value) => ((value as string).includes('line-through') ? {} : false),
      },
    ],
    toDOM() {
      return ['s', 0];
    },
  },
  onSchemaReady(ctx: ExtensionContext): ExtensionRuntime {
    return {
      commands: {
        toggleStrike: () => toggleMarkWithStoredMarks(ctx.schema.marks.strike),
      },
    };
  },
});
