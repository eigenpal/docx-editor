/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A runtime over an editor that is already open.
//
// It borrows, it does not own. The editor keeps its lifetime, its undo history and its caret; this
// runtime's `dispose()` releases the host adapter's subscription and leaves the editor mounted and
// editable. A batch here goes through the same transaction a keystroke does, so a scripted edit
// and a typed edit are the same edit and the painted pages repaint from it either way.
//
// NO `save()`. The editor already answers "what is the current document", and a second way to ask
// would be a second answer to keep in step. A host embedding the editor saves through the editor.
//
// This is the only module in the runtime that reaches the browser side of the engine. Everything
// else — the queue, the context, the object lifetime, the errors — is neutral and compiles without
// the DOM lib, which is what `__tests__/runtime-boundaries.test.ts` holds in place.
//
// PROOFING ANNOTATIONS PAINT HERE TOO, as editor text highlights. One highlight set per critique
// color scheme, because a set has one color: `docx-critique-<scheme>`, filled from the core
// stylesheet tokens, with the spelling and grammar schemes declaring their meaning through the
// set's `kind`. Two runtimes over one editor keep separate annotations but paint into the same
// sets, so each editor keeps every runtime's contribution and paints their union; disposing a
// runtime removes only its own marks.

import {
  beginEditorPreview,
  createBrowserAutomationHost,
  editorPreviewActive,
  reportAutomationException,
  reportAutomationRefusal,
  reportAutomationReviewSkip,
  type BrowserAutomationHost,
  type DocxEditorInstance,
  type HighlightKind,
  type HighlightRange,
} from '@docx-editor.dev/core/editor';
import {
  CRITIQUE_COLOR_SCHEMES,
  type AnnotationPaint,
  type AnnotationPainter,
  type CritiqueColorSchemeName,
} from './annotation-store.ts';
import {
  classifyRefusal,
  reviewOperationOf,
  reviewRefusalCode,
  trackedDuring,
} from './diagnostics.ts';
import { refusalCause } from './batch.ts';
import { createRuntime, type DocxEditorRuntime, type RevisionTextView } from './runtime.ts';

/**
 * How `DocxEditor.createBrowser` borrows a live editor.
 *
 * @public
 */
export interface CreateBrowserOptions {
  /**
   * Who comments this runtime writes are recorded as.
   *
   * Required to reply to a comment: `CT_TrackChange` makes `@w:author` mandatory, and the editor
   * does not expose a signed-in identity to automation. Omitted means comment writes refuse with
   * `NotSupported` and the diagnostic `edit.comment-author-required`; ordinary document reads
   * and writes are unaffected.
   *
   * To build a review UI over this editor, use `useReview()` from `@docx-editor.dev/pro/react`
   * or `@docx-editor.dev/pro/vue` instead. It comments and replies as the editor's author.
   */
  readonly author?: string;
  /**
   * Revision view for ordinary Office-compatible `text` loads and `search()` calls.
   *
   * Omitted means `allMarkup`.
   */
  readonly revisionTextView?: RevisionTextView;
}

// The editor instance, not the narrower `Editor` a document command programs against: the host
// adapter reads `editor.surface`, so an editor that only satisfies `Editor` would answer
// `document-unavailable` to every operation. Re-exported so the entry can write the signature
// down without naming the editor lane a second time.
export type { DocxEditorInstance };

export function createBrowser(
  editor: DocxEditorInstance,
  options: CreateBrowserOptions = {}
): DocxEditorRuntime {
  const host = createBrowserAutomationHost(editor);
  return createRuntime({
    host,
    save: false,
    // A refused batch reaches the editor's own diagnostics, so its telemetry module hears it.
    onRefusal: (error, operations) => {
      const review = reviewRefusalCode(error);
      if (review) {
        reportAutomationReviewSkip(
          editor,
          review,
          reviewOperationOf(operations),
          refusalCause(error)
        );
        return;
      }
      const { code, tracked } = classifyRefusal(error, host, operations);
      reportAutomationRefusal(editor, code, tracked, refusalCause(error));
    },
    onException: (error, operations) =>
      reportAutomationException(editor, error, trackedDuring(host, operations)),
    // Proofing annotations paint as the editor's text highlights.
    annotationPainter: editorAnnotationPainter(editor, host),
    // The editor validates the handle at each batch: only its own open groups bind.
    historyGroups: { begin: (group) => host.beginHistoryGroupRun(group) },
    // The editor forks and paints; the runtime records and replays. See `preview.ts`.
    preview: {
      begin: () => beginEditorPreview(editor),
      active: () => editorPreviewActive(editor),
      beginHistoryGroup: () => editor.beginHistoryGroup(),
      undo: () => editor.exec({ type: 'undo' }).ok,
    },
    ...(options.author === undefined ? {} : { author: options.author }),
    ...(options.revisionTextView === undefined
      ? {}
      : { revisionTextView: options.revisionTextView }),
  });
}

/** The highlight set a color scheme paints in, its fill token, and its meaning. */
const SCHEME_SETS: Readonly<
  Record<
    CritiqueColorSchemeName,
    { readonly name: string; readonly color: string; readonly kind?: HighlightKind }
  >
> = Object.freeze({
  Red: { name: 'docx-critique-red', color: 'var(--doc-critique-red-color)', kind: 'spelling' },
  Green: { name: 'docx-critique-green', color: 'var(--doc-critique-green-color)', kind: 'grammar' },
  Blue: { name: 'docx-critique-blue', color: 'var(--doc-critique-blue-color)', kind: 'grammar' },
  Lavender: { name: 'docx-critique-lavender', color: 'var(--doc-critique-lavender-color)' },
  Berry: { name: 'docx-critique-berry', color: 'var(--doc-critique-berry-color)' },
});

/** Below the shared search marks, which paint at priority 10. */
const CRITIQUE_PRIORITY = 5;

type Contribution = ReadonlyMap<CritiqueColorSchemeName, readonly HighlightRange[]>;

const CONTRIBUTIONS = new WeakMap<DocxEditorInstance, Map<object, Contribution>>();

function apply(editor: DocxEditorInstance, contributions: Map<object, Contribution>): void {
  for (const scheme of CRITIQUE_COLOR_SCHEMES) {
    const set = SCHEME_SETS[scheme];
    const ranges: HighlightRange[] = [];
    for (const contribution of contributions.values())
      ranges.push(...(contribution.get(scheme) ?? []));
    try {
      if (ranges.length === 0) editor.clearHighlights(set.name);
      else
        editor.setHighlights(set.name, ranges, {
          color: set.color,
          priority: CRITIQUE_PRIORITY,
          ...(set.kind === undefined ? {} : { kind: set.kind }),
        });
    } catch {
      // An editor between documents refuses highlights; the next paint tries again.
    }
  }
}

/** A painter for one runtime over `editor`, mapping spans through `host`. */
export function editorAnnotationPainter(
  editor: DocxEditorInstance,
  host: BrowserAutomationHost
): AnnotationPainter {
  let contributions = CONTRIBUTIONS.get(editor);
  if (!contributions) {
    contributions = new Map();
    CONTRIBUTIONS.set(editor, contributions);
  }
  const shared = contributions;
  const token = {};
  return {
    paint(spans: AnnotationPaint) {
      const contribution = new Map<CritiqueColorSchemeName, HighlightRange[]>();
      for (const [scheme, list] of spans) {
        const ranges: HighlightRange[] = [];
        for (const span of list) {
          const range = host.highlightRangeOf(span);
          if (range) ranges.push(range);
        }
        if (ranges.length) contribution.set(scheme, ranges);
      }
      if (contribution.size === 0 && !shared.has(token)) return;
      if (contribution.size === 0) shared.delete(token);
      else shared.set(token, contribution);
      apply(editor, shared);
    },
    dispose() {
      if (!shared.delete(token)) return;
      apply(editor, shared);
    },
  };
}
