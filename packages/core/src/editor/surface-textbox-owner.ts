// What the text box controller needs from the open header or footer story, so a box in a header
// or footer edits inside that story.

import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { createHeaderFooterScopeController } from './surface-hf-editing.ts';
import { partOfNodeId } from './surface-scope.ts';

type HeaderFooterScope = ReturnType<typeof createHeaderFooterScopeController>;

/** The header or footer dependencies of `createTextboxEditing`. */
export function textboxOwnerDeps(options: {
  readonly session: TreeDocxSessionView;
  readonly headerFooter: () => HeaderFooterScope | null;
  readonly sectionAtPage: (pageIndex: number) => { readonly sectionIndex: number };
  readonly exitNote: () => void;
}) {
  return {
    partOf: (nodeId: string) => partOfNodeId(options.session, nodeId) ?? null,
    leaveOtherStories: (owner?: { readonly rId: string }) => {
      options.exitNote();
      const scope = options.headerFooter();
      // A box in the open header or footer keeps that story open around it.
      if (owner && scope?.getActive()?.scope.rId === owner.rId) return;
      scope?.exitHeaderFooter();
    },
    headerFooter: {
      active: () => {
        const active = options.headerFooter()?.getActive();
        return active ? { rId: active.scope.rId, pageIndex: active.pageIndex } : null;
      },
      enter: (rId: string, pageIndex: number, kind: 'header' | 'footer') =>
        options.headerFooter()?.enterHeaderFooter({
          rId,
          pageIndex,
          sectionIndex: options.sectionAtPage(pageIndex).sectionIndex,
          kind,
        }) ?? false,
    },
  };
}
