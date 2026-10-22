import type { SurfaceCaretInput } from './surface-caret.ts';
import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import { findDirectChild } from '../store/package/drawing-shape-projection.ts';
import { schemaAttributeValue, WPS_NAMESPACE_URI } from '../store/package/ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI, type OoxmlPart } from '../store/package/ooxml-tree.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import { authoredRunPropertiesAt } from './surface-formatting.ts';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { ViewScope } from '../contracts/editor.ts';
import { translateParagraphFragment } from '../layout/paragraph-frame.ts';
import type { SemanticLayout, SemanticSelection } from '../layout/index.ts';
import { storyParagraphs } from '../store/package/story-blocks.ts';
import { textboxStoriesInPart } from '../store/package/textbox-stories.ts';
import {
  textboxDrawingOnPage,
  type TextboxDrawingRecord,
} from '../layout/textbox-drawing-records.ts';
import { furnitureTextboxDrawingsOnPage } from '../layout/furniture-textbox-records.ts';

type FrameScope = Extract<ViewScope, { kind: 'frame' }>;
type FurnitureOwner = { readonly kind: 'headerFooter'; readonly rId: string };

/** Where a text box being edited sits: its page, its record, and its extent's content origin. */
interface Placement {
  readonly pageIndex: number;
  readonly drawing: TextboxDrawingRecord;
  readonly origin: Readonly<{ x: number; y: number }>;
  /** The furniture story kind of a header or footer box. */
  readonly kind?: 'header' | 'footer';
}

/**
 * Where the box of `scope` sits in `layout`. A body box sits on one page. A header or footer
 * box repeats on every page that shows its story, so the preferred page wins when it shows it.
 */
function placementOf(
  layout: SemanticLayout,
  scope: FrameScope,
  preferredPage?: number
): Placement | null {
  const owner = scope.owner;
  if (!owner) {
    for (const page of layout.pages) {
      const drawing = textboxDrawingOnPage(page, scope.drawingNodeId);
      if (drawing) return { pageIndex: page.index, drawing, origin: drawing };
    }
    return null;
  }
  if (owner.kind !== 'headerFooter') return null;
  const candidate = preferredPage === undefined ? undefined : layout.pages[preferredPage];
  const preferred = candidate?.index === preferredPage ? candidate : undefined;
  for (const page of preferred ? [preferred, ...layout.pages] : layout.pages) {
    const found = furnitureTextboxDrawingsOnPage(page).find(
      (record) =>
        record.drawing.drawingNodeId === scope.drawingNodeId &&
        (record.rId === undefined || record.rId === owner.rId)
    );
    if (found)
      return {
        pageIndex: page.index,
        drawing: found.drawing,
        origin: found.origin,
        kind: found.kind,
      };
  }
  return null;
}

/**
 * Reuse the surface's text input and history with a textbox's own paragraph geometry.
 *
 * A box in a header or footer is edited inside that story: entering it opens the story first,
 * which keeps writes, undo and collaboration on the story's part, and the box edits on the
 * page it was entered from.
 */
export function createTextboxEditing(deps: {
  session: TreeDocxSessionView;
  pagesLayer: HTMLElement;
  layout(): SemanticLayout;
  selection(): SemanticSelection;
  setSelection(selection: SemanticSelection): void;
  flush(): void;
  /** Leave the note and any header or footer other than `owner`. */
  leaveOtherStories(owner?: FurnitureOwner): void;
  writable(): boolean;
  /** The part a node id names, without opening a story for it. */
  partOf(nodeId: string): OoxmlPart | null;
  headerFooter: {
    /** The open header or footer story, and the page it is edited on. */
    active(): { readonly rId: string; readonly pageIndex: number } | null;
    enter(rId: string, pageIndex: number, kind: 'header' | 'footer'): boolean;
  };
}) {
  let active: FrameScope | null = null;
  let activePage: number | undefined;
  let saved: SemanticSelection | null = null;
  let cached: { base: SemanticLayout; id: string; layout: SemanticLayout } | null = null;
  const boxPartOf = (scope: FrameScope) =>
    scope.owner ? deps.partOf(scope.drawingNodeId) : deps.session.part();
  const storyOf = (scope: FrameScope) => {
    const part = boxPartOf(scope);
    return part
      ? textboxStoriesInPart(part).find(
          (story) => story.root.id === scope.id && story.drawingNodeId === scope.drawingNodeId
        )
      : undefined;
  };
  const root = () => active && storyOf(active);
  /** A box whose header or footer closed under it is no longer being edited. */
  const ownerOpen = (scope: FrameScope) =>
    !scope.owner ||
    (scope.owner.kind === 'headerFooter' && deps.headerFooter.active()?.rId === scope.owner.rId);
  const syncDom = () => {
    // A deleted box returns the caret to where it was; a closed story already placed it.
    if (active && !ownerOpen(active)) {
      exit(false);
      return;
    }
    if (active && !root()) {
      exit();
      return;
    }
    for (const box of deps.pagesLayer.querySelectorAll<HTMLElement>('.docx-drawing-textbox')) {
      // A header or footer box repeats on every page of its story; only the copy on the page
      // it is edited on binds, so the native selection and focus stay with the engine caret.
      const editing =
        box.dataset.drawingNodeId === active?.drawingNodeId &&
        (activePage === undefined ||
          box.closest('[data-page-index]')?.getAttribute('data-page-index') === String(activePage));
      const was = box.dataset.docxTextboxActive;
      // Kept elements carry their last state; a repainted box comes with inert bindings.
      if (was === String(editing)) continue;
      box.dataset.docxTextboxActive = String(editing);
      box.contentEditable = editing ? 'true' : 'false';
      box.setAttribute('role', editing ? 'textbox' : 'img');
      if (editing) {
        box.removeAttribute('aria-hidden');
        box.setAttribute('aria-multiline', 'true');
      } else {
        box.removeAttribute('aria-multiline');
        if (!box.hasAttribute('aria-label')) box.setAttribute('aria-hidden', 'true');
        if (was !== 'true') continue;
      }
      for (const bound of box.querySelectorAll<HTMLElement>('[data-textbox-paragraph-id]')) {
        if (editing) bound.dataset.paragraphId = bound.dataset.textboxParagraphId;
        else delete bound.dataset.paragraphId;
      }
    }
  };
  const exit = (restore = true) => {
    if (!active) return;
    deps.flush();
    active = null;
    activePage = undefined;
    cached = null;
    syncDom();
    if (restore && saved) deps.setSelection(saved);
    saved = null;
  };
  const enter = (scope: FrameScope, pageIndex?: number): boolean => {
    if (scope.owner && scope.owner.kind !== 'headerFooter') return false;
    if (!deps.writable()) return false;
    deps.flush();
    const part = boxPartOf(scope);
    const story =
      part &&
      textboxStoriesInPart(part).find(
        (candidate) =>
          candidate.root.id === scope.id &&
          candidate.drawingNodeId === scope.drawingNodeId &&
          candidate.hostParagraphId === scope.hostParagraphId
      );
    // Shape transforms are separate from the picture transform on the layout record.
    const textbox = part && story && parentNodeOf(part, story.root.id);
    const shape = textbox && parentNodeOf(part, textbox.id);
    const shapeProperties =
      shape &&
      findDirectChild(shape.children, { namespaceUri: WPS_NAMESPACE_URI, localName: 'spPr' });
    const transform =
      shapeProperties &&
      findDirectChild(shapeProperties.children, {
        namespaceUri: DRAWINGML_MAIN_NAMESPACE_URI,
        localName: 'xfrm',
      });
    const bodyProperties =
      shape &&
      findDirectChild(shape.children, { namespaceUri: WPS_NAMESPACE_URI, localName: 'bodyPr' });
    const rotation = transform && schemaAttributeValue(transform.attributes, 'rot');
    const textRotation = bodyProperties && schemaAttributeValue(bodyProperties.attributes, 'rot');
    const vertical = bodyProperties && schemaAttributeValue(bodyProperties.attributes, 'vert');
    if (
      (rotation && Number(rotation) !== 0) ||
      (textRotation && Number(textRotation) !== 0) ||
      (vertical && vertical !== 'horz')
    )
      return false;
    const open = deps.headerFooter.active();
    const owner = scope.owner as FurnitureOwner | undefined;
    const preferred = pageIndex ?? (owner && open?.rId === owner.rId ? open.pageIndex : undefined);
    const placed = placementOf(deps.layout(), scope, preferred);
    const drawing = placed?.drawing;
    if (
      !story ||
      !placed ||
      !drawing ||
      drawing.transform.rotationDegrees !== 0 ||
      // Turned text has no upright caret geometry; upright text in a turned box keeps it.
      drawing.textboxStory.contentRotation !== undefined ||
      drawing.textboxStory.fragments.some((fragment) => fragment.kind !== 'paragraph')
    )
      return false;
    const first = drawing.textboxStory.fragments[0];
    if (!first || first.kind !== 'paragraph') return false;
    if (active?.id === scope.id && activePage === (owner ? placed.pageIndex : undefined))
      return true;
    exit();
    // A header or footer box edits inside its story: open that story on the box's page, so
    // the open band and the section it edits are the box's.
    if (owner && (open?.rId !== owner.rId || open.pageIndex !== placed.pageIndex)) {
      if (!placed.kind || !deps.headerFooter.enter(owner.rId, placed.pageIndex, placed.kind))
        return false;
    }
    deps.leaveOtherStories(owner);
    saved = deps.selection();
    active = scope;
    activePage = owner ? placed.pageIndex : undefined;
    cached = null;
    syncDom();
    const position = { paragraphId: first.paragraphId, offset: first.range.start };
    deps.setSelection({ anchor: position, head: position });
    return true;
  };
  const placement = (base: SemanticLayout) =>
    active ? placementOf(base, active, activePage) : null;
  return {
    active: () => active,
    replacementFormatOps(paragraphId: string, offset: number, length: number): TreeDocOp[] {
      const { anchor, head } = deps.selection();
      const part = active && boxPartOf(active);
      if (
        !part ||
        length === 0 ||
        (anchor.paragraphId === head.paragraphId && anchor.offset === head.offset)
      )
        return [];
      const properties = authoredRunPropertiesAt(part, paragraphId, offset);
      return properties.length
        ? [{ op: 'setRunProperties', paragraphId, start: offset, end: offset + length, properties }]
        : [];
    },
    enter: (scope: FrameScope) => enter(scope),
    exit,
    syncDom,
    contains: (paragraphId: string) => {
      const story = root();
      return !!story && storyParagraphs(story.root).some((p) => p.id === paragraphId);
    },
    paragraphIds: () => {
      const story = root();
      return story ? storyParagraphs(story.root).map((p) => p.id) : [];
    },
    caretInput(
      base: SemanticLayout
    ): Partial<Pick<SurfaceCaretInput, 'scopedHost' | 'scopedHostKind' | 'scopedOrigin'>> {
      const placed = placement(base);
      if (!placed) return {};
      const id = placed.drawing.drawingNodeId;
      // The box on the page being edited: a header box is painted once per page.
      const box = [...deps.pagesLayer.querySelectorAll<HTMLElement>('.docx-drawing-textbox')].find(
        (element) =>
          element.dataset.drawingNodeId === id &&
          element.closest<HTMLElement>('[data-page-index]')?.dataset.pageIndex ===
            String(placed.pageIndex)
      );
      const host = box?.querySelector<HTMLElement>('.docx-drawing-textbox-content');
      if (!host) return {};
      const story = placed.drawing.textboxStory;
      return {
        scopedHost: host,
        scopedHostKind: 'textbox',
        scopedOrigin: {
          x: placed.origin.x + story.contentOffset.x,
          y: placed.origin.y + story.contentOffset.y,
        },
      };
    },
    layout(base: SemanticLayout): SemanticLayout {
      if (!active) return base;
      if (cached?.base === base && cached.id === active.id) return cached.layout;
      const placed = placement(base);
      const story = placed?.drawing.textboxStory;
      // Only the page being edited carries the story, so a header box shared by many pages
      // lays its paragraphs out once.
      const fragments =
        placed && story
          ? story.fragments.flatMap((fragment) =>
              fragment.kind === 'paragraph'
                ? [
                    translateParagraphFragment(
                      fragment,
                      placed.origin.x + story.contentOffset.x,
                      placed.origin.y + story.contentOffset.y
                    ),
                  ]
                : []
            )
          : [];
      const layout: SemanticLayout = {
        ...base,
        pages: base.pages.map((page) => ({
          ...page,
          header: undefined,
          footer: undefined,
          footnotes: undefined,
          endnotes: undefined,
          anchoredDrawings: [],
          fragments: active!.owner
            ? page.index === placed?.pageIndex
              ? fragments
              : []
            : textboxDrawingOnPage(page, active!.drawingNodeId)
              ? fragments
              : [],
        })),
      };
      cached = { base, id: active.id, layout };
      return layout;
    },
    preparePointer(element: Element | null): boolean {
      const content = element?.closest('.docx-drawing-textbox-content');
      const id = content?.closest<HTMLElement>('[data-drawing-node-id]')?.dataset.drawingNodeId;
      const body =
        id &&
        textboxStoriesInPart(deps.session.part()).find(
          (candidate) => candidate.drawingNodeId === id
        );
      if (
        body &&
        enter({
          kind: 'frame',
          id: body.root.id,
          drawingNodeId: body.drawingNodeId,
          hostParagraphId: body.hostParagraphId,
        })
      )
        return true;
      // A header or footer box: its story owns it, and the press names the page.
      const pageIndex = Number(
        content?.closest<HTMLElement>('[data-page-index]')?.dataset.pageIndex
      );
      const page = Number.isInteger(pageIndex)
        ? deps.layout().pages.find((candidate) => candidate.index === pageIndex)
        : undefined;
      const record =
        id && page
          ? furnitureTextboxDrawingsOnPage(page).find((found) => found.drawing.drawingNodeId === id)
          : undefined;
      const part = record?.rId && id ? deps.partOf(id) : null;
      const owned =
        part && textboxStoriesInPart(part).find((candidate) => candidate.drawingNodeId === id);
      if (
        record?.rId &&
        owned &&
        enter(
          {
            kind: 'frame',
            id: owned.root.id,
            drawingNodeId: owned.drawingNodeId,
            hostParagraphId: owned.hostParagraphId,
            owner: { kind: 'headerFooter', rId: record.rId },
          },
          pageIndex
        )
      )
        return true;
      exit(false);
      return false;
    },
  };
}
