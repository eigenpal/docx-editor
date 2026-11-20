/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The React mount of the review rail render tests: an editor with a rail, and a rail whose
// cards count their renders. The Vue twin is `review-rail-render-work-vue-harness.ts`.

import { Profiler, type ReactNode } from 'react';
import { act, render } from '@testing-library/react';
import { DocxEditorContent, DocxEditorRoot, DocxEditorViewport } from '@docx-editor.dev/react';
import type { DocxEditorInstance, EditorModule } from '@docx-editor.dev/core/editor';
import { reviewModule } from '../index.ts';
import { DocxEditorReview, type ReviewItemView, type ReviewProps } from '../react/index.ts';
import { AUTHOR, counter, pagedTrackedDocument } from './review-rail-render-work-harness.ts';

export async function settle(ms = 30): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

export async function waitFor(predicate: () => boolean, attempts = 80): Promise<void> {
  for (let i = 0; i < attempts && !predicate(); i++) await settle(25);
}

export interface MountRailOptions {
  /** The element whose `data-testid` says the rail is ready. */
  readonly ready?: string;
  /** The document. The paged document with one tracked change on each page by default. */
  readonly source?: Uint8Array;
  /** The editor modules. The review module alone by default. */
  readonly modules?: readonly EditorModule[];
  /** Wraps the editor root, for example in a `LocaleProvider`. */
  readonly wrap?: (root: ReactNode) => ReactNode;
}

export async function mountRail(review: ReactNode, options: MountRailOptions = {}) {
  let editor: DocxEditorInstance | null = null;
  const source = options.source ?? pagedTrackedDocument();
  const modules = options.modules ?? [reviewModule()];
  const tree = (rail: ReactNode, wrap = options.wrap) => {
    const root = (
      <DocxEditorRoot
        document={source}
        modules={modules}
        // The author of the document's changes, so a reply adds no author and can be edited.
        author={AUTHOR}
        onReady={(instance) => {
          editor = instance as DocxEditorInstance;
        }}
      >
        <DocxEditorViewport>
          <DocxEditorContent />
          {rail}
        </DocxEditorViewport>
      </DocxEditorRoot>
    );
    return wrap ? wrap(root) : root;
  };
  const view = render(tree(review));
  const ready = options.ready ?? 'review-card';
  await waitFor(() => view.container.querySelector(`[data-testid="${ready}"]`) !== null);
  await settle(60);
  return {
    container: view.container,
    editor: editor!,
    /** Render the tree again with another rail, and another wrapper when one is given. */
    rerender: (rail: ReactNode, wrap?: (root: ReactNode) => ReactNode) =>
      view.rerender(tree(rail, wrap)),
  };
}

/**
 * A rail whose cards come from a render prop. `templates` counts the calls of the render
 * prop, `cards` the renders of each card, and `commits` the renders of the rail. `railWith`
 * answers the same rail with other props and the same render prop.
 */
export function countingRail(props: Omit<ReviewProps, 'children'> = {}) {
  const templates = counter();
  const cards = counter();
  const commits = counter();
  const template = (item: ReviewItemView) => (
    <Profiler id={item.key} onRender={(id) => cards.add(id)}>
      {(templates.add(item.key), null)}
      <div data-card-key={item.key}>
        <DocxEditorReview.Card />
      </div>
    </Profiler>
  );
  const railWith = (railProps: Omit<ReviewProps, 'children'>) => (
    <Profiler id="rail" onRender={(id) => commits.add(id)}>
      <DocxEditorReview {...railProps}>{template}</DocxEditorReview>
    </Profiler>
  );
  const reset = () => {
    templates.reset();
    cards.reset();
    commits.reset();
  };
  return { rail: railWith(props), railWith, templates, cards, commits, reset };
}
