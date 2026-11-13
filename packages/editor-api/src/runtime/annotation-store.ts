/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Proofing annotations: view state that one runtime keeps beside the document.
//
// AN ANNOTATION IS NOT DOCUMENT CONTENT. It is never written to the file, never sent to a
// collaborator, and gone when the runtime is disposed. So it lives here, keyed by the paragraph
// handle the host minted, and not in the canonical tree.
//
// OFFSETS FOLLOW THE TEXT A READ SHOWS. A critique counts in the paragraph text that
// `Paragraph.text` reads in this runtime's revision view. The store keeps that text as it was
// when it last looked. When the paragraph's text changes, the common start and the common end
// of the two texts are unchanged text: an annotation inside the common start keeps its offset,
// one inside the common end moves by the length difference, and one that touches the changed
// middle is removed. A single edit between two looks is followed exactly. An annotation never
// moves onto text other than the text it was placed on.
//
// PAINTING IS A PORT. A browser runtime paints live annotations as editor highlights; a server
// runtime has nothing to paint. The store calls the port after a sync that changed annotations,
// with the model spans it maps through read-only host batches.

import type {
  AutomationHandle,
  AutomationHost,
  AutomationOperation,
  AutomationSpan,
  AutomationValue,
} from '@docx-editor.dev/core/automation';
import type { RevisionTextView } from './runtime.ts';

/** A critique color scheme, as `Word.CritiqueColorScheme` spells it. */
export type CritiqueColorSchemeName = 'Red' | 'Green' | 'Blue' | 'Lavender' | 'Berry';

/** An annotation state, as `Word.AnnotationState` spells it. */
export type AnnotationStateName = 'Created' | 'Accepted' | 'Rejected';

export const CRITIQUE_COLOR_SCHEMES: readonly CritiqueColorSchemeName[] = [
  'Red',
  'Green',
  'Blue',
  'Lavender',
  'Berry',
];

/** Most critiques one `insertAnnotations` call may carry. */
export const MAX_CRITIQUES_PER_CALL = 1000;
/** Most live annotations one runtime keeps. The editor paints at most 10000 marks per set. */
export const MAX_LIVE_ANNOTATIONS = 10000;

/** One critique as the store keeps it: validated and frozen. */
export interface CritiqueRecord {
  readonly colorScheme: CritiqueColorSchemeName;
  readonly length: number;
  readonly suggestions: readonly string[] | undefined;
}

export interface AnnotationRecord {
  readonly id: string;
  readonly paragraph: AutomationHandle;
  readonly critique: CritiqueRecord;
  /** The critiqued text, in the runtime's revision view. */
  readonly text: string;
  /** Current offset of `text` in the paragraph's text. */
  start: number;
  state: AnnotationStateName;
  /** Whether the annotation is on the paragraph: created, and not removed or decided. */
  live: boolean;
}

/** Live model spans per color scheme, for a painter. */
export type AnnotationPaint = ReadonlyMap<CritiqueColorSchemeName, readonly AutomationSpan[]>;

/** Paints a runtime's live annotations. Only the browser runtime has one. */
export interface AnnotationPainter {
  paint(spans: AnnotationPaint): void;
  dispose(): void;
}

interface ParagraphEntry {
  readonly paragraph: AutomationHandle;
  text: string;
  readonly ids: Set<string>;
}

/** Stores made in this process, so each store's ids carry their own prefix. */
let stores = 0;

export class AnnotationStore {
  readonly #records = new Map<string, AnnotationRecord>();
  readonly #paragraphs = new Map<string, ParagraphEntry>();
  readonly #token = `a${String((stores += 1))}`;
  readonly #host: AutomationHost;
  readonly #view: RevisionTextView;
  readonly #painter: AnnotationPainter | undefined;
  #counter = 0;
  #dirty = false;
  /** The host revision the marks were last painted at. */
  #paintedAt: number | null = null;

  constructor(host: AutomationHost, view: RevisionTextView, painter?: AnnotationPainter) {
    this.#host = host;
    this.#view = view;
    this.#painter = painter;
  }

  /** The revision view every annotation offset counts in. */
  get view(): RevisionTextView {
    return this.#view;
  }

  /** How many annotations are live, across every paragraph. */
  get liveCount(): number {
    let count = 0;
    for (const entry of this.#paragraphs.values()) count += entry.ids.size;
    return count;
  }

  record(id: string): AnnotationRecord | undefined {
    return this.#records.get(id);
  }

  /** The live annotations of a paragraph, in text order. */
  liveIn(paragraph: AutomationHandle): readonly AnnotationRecord[] {
    const entry = this.#paragraphs.get(paragraph.ref);
    if (!entry) return [];
    const live: AnnotationRecord[] = [];
    for (const id of entry.ids) {
      const record = this.#records.get(id);
      if (record?.live) live.push(record);
    }
    return live.sort((left, right) => left.start - right.start);
  }

  /**
   * Bring a paragraph's annotations up to its current text. `null` means the paragraph is gone,
   * which removes every annotation on it.
   */
  reconcile(paragraph: AutomationHandle, text: string | null): void {
    const entry = this.#paragraphs.get(paragraph.ref);
    if (!entry) return;
    if (text === null) {
      for (const id of entry.ids) this.#remove(id);
      this.#paragraphs.delete(paragraph.ref);
      this.#dirty = true;
      return;
    }
    const before = entry.text;
    if (before === text) return;
    const limit = Math.min(before.length, text.length);
    let prefix = 0;
    while (prefix < limit && before.charCodeAt(prefix) === text.charCodeAt(prefix)) prefix += 1;
    let suffix = 0;
    while (
      suffix < limit - prefix &&
      before.charCodeAt(before.length - 1 - suffix) === text.charCodeAt(text.length - 1 - suffix)
    ) {
      suffix += 1;
    }
    const delta = text.length - before.length;
    for (const id of [...entry.ids]) {
      const record = this.#records.get(id)!;
      const end = record.start + record.text.length;
      let start: number | null = null;
      if (end <= prefix) start = record.start;
      else if (record.start >= before.length - suffix) start = record.start + delta;
      if (start === null || text.slice(start, start + record.text.length) !== record.text) {
        this.#remove(id);
      } else {
        record.start = start;
      }
    }
    entry.text = text;
    this.#dirty = true;
  }

  /** Add annotations on a paragraph whose current text is `text`. Answers their ids. */
  add(
    paragraph: AutomationHandle,
    text: string,
    critiques: readonly (CritiqueRecord & { readonly start: number })[]
  ): string[] {
    let entry = this.#paragraphs.get(paragraph.ref);
    if (entry) this.reconcile(paragraph, text);
    else {
      entry = { paragraph, text, ids: new Set() };
      this.#paragraphs.set(paragraph.ref, entry);
    }
    const ids: string[] = [];
    for (const critique of critiques) {
      this.#counter += 1;
      const id = `${this.#token}-${String(this.#counter)}`;
      this.#records.set(id, {
        id,
        paragraph,
        critique: {
          colorScheme: critique.colorScheme,
          length: critique.length,
          suggestions: critique.suggestions,
        },
        text: text.slice(critique.start, critique.start + critique.length),
        start: critique.start,
        state: 'Created',
        live: true,
      });
      entry.ids.add(id);
      ids.push(id);
    }
    this.#dirty = true;
    return ids;
  }

  /** Take an annotation off its paragraph after `accept()` or `reject()`; its state stays readable. */
  decide(id: string, state: 'Accepted' | 'Rejected'): void {
    const record = this.#records.get(id);
    if (!record?.live) return;
    record.state = state;
    record.live = false;
    this.#paragraphs.get(record.paragraph.ref)?.ids.delete(id);
    this.#dirty = true;
  }

  /** Forget an annotation entirely, as `delete()` does. */
  delete(id: string): void {
    this.#remove(id);
    this.#dirty = true;
  }

  #remove(id: string): void {
    const record = this.#records.get(id);
    if (!record) return;
    this.#records.delete(id);
    this.#paragraphs.get(record.paragraph.ref)?.ids.delete(id);
  }

  /**
   * Repaint after a sync that changed annotations or the document: re-read each annotated
   * paragraph, follow its text, map every live annotation to its model span, and hand the spans
   * to the painter.
   * Read-only host batches; a refused or failed read paints nothing rather than old marks.
   */
  paintIfChanged(): void {
    if (!this.#painter) return;
    let revision: number | null = null;
    try {
      revision = this.#host.revision();
    } catch {
      /* a host without a document paints what the store says */
    }
    const moved = this.#paragraphs.size > 0 && revision !== this.#paintedAt;
    if (!this.#dirty && !moved) return;
    this.#dirty = false;
    this.#paintedAt = revision;
    const projection = this.#view;
    try {
      const entries = [...this.#paragraphs.values()];
      const texts = this.#execute(
        entries.map((entry) => ({
          op: 'getParagraphTextIfPresent',
          paragraph: entry.paragraph,
          projection,
        }))
      );
      if (!texts) return this.#painter.paint(new Map());
      entries.forEach((entry, index) => {
        const value = texts[index];
        const text = value?.kind === 'texts' ? (value.texts[0] ?? null) : null;
        this.reconcile(entry.paragraph, text);
      });
      const live = [...this.#paragraphs.values()].flatMap((entry) => this.liveIn(entry.paragraph));
      const spans = this.#execute(
        live.map((record) => ({
          op: 'getParagraphTextSpan',
          paragraph: record.paragraph,
          start: record.start,
          length: record.text.length,
          projection,
        }))
      );
      const paint = new Map<CritiqueColorSchemeName, AutomationSpan[]>();
      if (spans) {
        live.forEach((record, index) => {
          const value = spans[index];
          if (value?.kind !== 'span') return;
          const list = paint.get(record.critique.colorScheme) ?? [];
          list.push(value.span);
          paint.set(record.critique.colorScheme, list);
        });
      }
      this.#dirty = false;
      this.#painter.paint(paint);
    } catch {
      // Painting is view state: a host that cannot answer right now paints nothing.
      try {
        this.#painter.paint(new Map());
      } catch {
        /* the painter's own failure must not reach the caller's sync */
      }
    }
  }

  /** One read-only batch, or `null` when the host refused it. */
  #execute(operations: AutomationOperation[]): readonly (AutomationValue | undefined)[] | null {
    if (operations.length === 0) return [];
    const response = this.#host.execute({ operations });
    if (!response.ok) return null;
    return response.results.map((result) => (result.status === 'ok' ? result.value : undefined));
  }

  /** Remove the runtime's marks. Called once, when the runtime is disposed. */
  dispose(): void {
    this.#records.clear();
    this.#paragraphs.clear();
    try {
      this.#painter?.dispose();
    } catch {
      /* disposal must not throw */
    }
  }
}
