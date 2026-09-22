import { paragraphTextOf, type ReviewRevisionItem } from '../store/index.ts';
import { allParagraphs } from '../binding/tree-binding.ts';
import { paragraphFragmentsOf } from '../layout/semantic-record-queries.ts';
import { paragraphContentBounds } from '../layout/paragraph-content-bounds.ts';
import type { DocxEditorInstance } from './docx-editor-types.ts';
import type {
  RefreshChange,
  RefreshChangeInput,
  RefreshLocation,
} from './document-refresh-types.ts';
import type { RefreshHost } from './document-refresh-host.ts';

export interface LocatedChange {
  change: RefreshChange;
  fingerprint: string;
  paragraphId?: string;
  offset?: number;
}
function revisionFingerprint(item: ReviewRevisionItem): string {
  return JSON.stringify([item.revisionKind, item.author, item.date, item.text, item.replacedText]);
}
export function revisionChangeKeys(host: RefreshHost): Map<string, string> {
  return new Map(
    host
      .surface()
      ?.session.reviewItems()
      .filter((item) => item.kind === 'revision')
      .map((item) => [item.id, revisionFingerprint(item)])
  );
}
export function resolveRefreshChanges(
  host: RefreshHost,
  resultId: string,
  inputs: readonly RefreshChangeInput[] | undefined,
  seen: ReadonlyMap<string, string>
): { located: LocatedChange[]; available: boolean } {
  const surface = host.surface();
  if (!surface) return { located: [], available: false };
  const part = surface.session.part();
  const paragraphs = allParagraphs(part);
  const anchors = surface.session.paragraphAnchors().paraIdByNode;
  const byAnchor = new Map<string, (typeof paragraphs)[number] | null>();
  const indices = new Map<string, number>();
  paragraphs.forEach((paragraph, index) => {
    indices.set(paragraph.id, index);
    const anchor = anchors.get(paragraph.id);
    if (anchor) byAnchor.set(anchor, byAnchor.has(anchor) ? null : paragraph);
  });
  const placedIds = new Set(
    surface.layout().pages.flatMap((page) => paragraphFragmentsOf(page).map((p) => p.paragraphId))
  );
  const resolve = (
    input: RefreshChangeInput,
    fingerprint = JSON.stringify([
      typeof input.location?.text === 'string' ? input.location.text : null,
      input.unavailableReason,
    ])
  ): LocatedChange => {
    const base = { id: input.id, resultId, isNew: seen.get(input.id) !== fingerprint };
    if (!input.location)
      return { fingerprint, change: { ...base, status: input.unavailableReason ?? 'unavailable' } };
    const location = input.location;
    const paragraph =
      location.paragraphId !== undefined
        ? byAnchor.get(location.paragraphId)
        : Number.isSafeInteger(location.paragraphIndex) && location.paragraphIndex! >= 0
          ? paragraphs[location.paragraphIndex!]
          : undefined;
    const text = paragraph ? (paragraphTextOf(part, paragraph.id) ?? '') : '';
    if (
      !paragraph ||
      (location.paragraphId !== undefined && location.paragraphIndex !== undefined) ||
      !Number.isSafeInteger(location.start) ||
      !Number.isSafeInteger(location.end) ||
      location.start < 0 ||
      location.end <= location.start ||
      location.end > text.length ||
      text.slice(location.start, location.end) !== location.text
    ) {
      return { fingerprint, change: { ...base, status: 'invalid' } };
    }
    const placed = placedIds.has(paragraph.id);
    return {
      fingerprint,
      change: {
        ...base,
        status: placed ? 'available' : 'unavailable',
        location: Object.freeze({ ...location }),
      },
      ...(placed ? { paragraphId: paragraph.id, offset: location.start } : {}),
    };
  };
  if (inputs) return { located: inputs.map((input) => resolve(input)), available: true };
  const revisions = surface.session.reviewItems().filter((item) => item.kind === 'revision');
  const located = revisions.map((item): LocatedChange => {
    const fingerprint = revisionFingerprint(item);
    const range = item.ranges[0];
    if (!range || range.partName !== part.name)
      return {
        fingerprint,
        change: {
          id: item.id,
          resultId,
          isNew: seen.get(item.id) !== fingerprint,
          status: range ? 'unsupported-story' : 'unavailable',
        },
      };
    const index = indices.get(range.start.paragraphId) ?? -1;
    if (item.revisionKind === 'delete' || item.revisionKind === 'moveFrom') {
      return {
        fingerprint,
        change: {
          id: item.id,
          resultId,
          isNew: seen.get(item.id) !== fingerprint,
          status: 'deleted',
        },
      };
    }
    // Only an exact single-paragraph range can name a temporary highlight.
    if (range.start.paragraphId !== range.end.paragraphId)
      return {
        fingerprint,
        change: {
          id: item.id,
          resultId,
          isNew: seen.get(item.id) !== fingerprint,
          status: 'unavailable',
        },
      };
    const text = paragraphTextOf(part, range.start.paragraphId) ?? '';
    const location: RefreshLocation = {
      paragraphIndex: index,
      start: range.start.offset,
      end: range.end.offset,
      text: text.slice(range.start.offset, range.end.offset),
    };
    return resolve({ id: item.id, location }, fingerprint);
  });
  return { located, available: revisions.length > 0 };
}

/** Temporary paragraph bands. Geometry follows layout, including virtualized pages. */
export function createRefreshHighlights(editor: DocxEditorInstance, host: RefreshHost) {
  let selected: readonly LocatedChange[] = [];
  let elements: HTMLElement[] = [];
  let observer: MutationObserver | null = null;
  let observing: HTMLElement | null = null;
  const remove = () => {
    for (const element of elements) element.remove();
    elements = [];
  };
  const paint = () => {
    observer?.disconnect();
    remove();
    const surface = host.surface();
    const container = host.container();
    if (!surface || !container || selected.length === 0) return;
    const ids = new Set(selected.map((entry) => entry.paragraphId));
    const scale = editor.getRenderScale();
    for (const page of surface.layout().pages) {
      const parent = container.querySelector<HTMLElement>(
        `[data-page-index="${page.index}"] > .docx-page-content`
      );
      if (!parent) continue;
      for (const paragraph of paragraphFragmentsOf(page)) {
        if (!ids.has(paragraph.paragraphId)) continue;
        const box = paragraphContentBounds(paragraph);
        const band = container.ownerDocument.createElement('div');
        band.setAttribute('data-docx-marker', '');
        band.setAttribute('data-docx-refresh-highlight', '');
        band.setAttribute('contenteditable', 'false');
        band.setAttribute('aria-hidden', 'true');
        band.style.cssText =
          'position:absolute;pointer-events:none;background:var(--doc-selection);outline:1px solid var(--doc-primary);';
        band.style.left = `${box.x * scale}px`;
        band.style.top = `${box.y * scale}px`;
        band.style.width = `${box.width * scale}px`;
        band.style.height = `${box.height * scale}px`;
        parent.append(band);
        elements.push(band);
      }
    }
    observing = container;
    observer ??= new MutationObserver(paint);
    observer.observe(container, { childList: true, subtree: true });
  };
  editor.on('selectionChange', () => {
    if (selected.length) paint();
  });
  return {
    show(changes: readonly LocatedChange[]) {
      selected = changes;
      paint();
    },
    clear() {
      selected = [];
      observer?.disconnect();
      observing = null;
      remove();
    },
    repaint() {
      if (observing) paint();
    },
  };
}
