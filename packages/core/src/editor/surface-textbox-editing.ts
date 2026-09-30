import { parentNodeOf } from '../store/package/ooxml-edit.ts';
import { findDirectChild } from '../store/package/drawing-shape-projection.ts';
import { schemaAttributeValue, WPS_NAMESPACE_URI } from '../store/package/ooxml-drawing-rules.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI } from '../store/package/ooxml-tree.ts';
import type { TreeDocOp } from '../store/store/tree-op-types.ts';
import { authoredRunPropertiesAt } from './surface-formatting.ts';
import type { TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { ViewScope } from '../contracts/editor.ts';
import { translateParagraphFragment } from '../layout/paragraph-frame.ts';
import type { SemanticLayout, SemanticSelection } from '../layout/index.ts';
import { storyParagraphs } from '../store/package/story-blocks.ts';
import { textboxStoriesInPart } from '../store/package/textbox-stories.ts';

type FrameScope = Extract<ViewScope, { kind: 'frame' }>;

/** Reuse the surface's text input and history with a textbox's own paragraph geometry. */
export function createTextboxEditing(deps: {
  session: TreeDocxSessionView;
  pagesLayer: HTMLElement;
  layout(): SemanticLayout;
  selection(): SemanticSelection;
  setSelection(selection: SemanticSelection): void;
  flush(): void;
  leaveOtherStories(): void;
  writable(): boolean;
}) {
  let active: FrameScope | null = null;
  let saved: SemanticSelection | null = null;
  let cached: { base: SemanticLayout; id: string; layout: SemanticLayout } | null = null;
  const root = () =>
    active &&
    textboxStoriesInPart(deps.session.part()).find(
      (story) => story.root.id === active!.id && story.drawingNodeId === active!.drawingNodeId
    );
  const syncDom = () => {
    for (const box of deps.pagesLayer.querySelectorAll<HTMLElement>('.docx-drawing-textbox')) {
      const editing = box.dataset.drawingNodeId === active?.drawingNodeId;
      box.dataset.docxTextboxActive = String(editing);
      box.contentEditable = editing ? 'true' : 'false';
      box.setAttribute('role', editing ? 'textbox' : 'img');
      if (editing) {
        box.removeAttribute('aria-hidden');
        box.setAttribute('aria-multiline', 'true');
      } else {
        box.removeAttribute('aria-multiline');
        if (!box.hasAttribute('aria-label')) box.setAttribute('aria-hidden', 'true');
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
    cached = null;
    syncDom();
    if (restore && saved) deps.setSelection(saved);
    saved = null;
  };
  const enter = (scope: FrameScope): boolean => {
    if (scope.owner || !deps.writable()) return false;
    deps.flush();
    const story = textboxStoriesInPart(deps.session.part()).find(
      (candidate) =>
        candidate.root.id === scope.id &&
        candidate.drawingNodeId === scope.drawingNodeId &&
        candidate.hostParagraphId === scope.hostParagraphId
    );
    // Shape transforms are separate from the picture transform on the layout record.
    const textbox = story && parentNodeOf(deps.session.part(), story.root.id);
    const shape = textbox && parentNodeOf(deps.session.part(), textbox.id);
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
    const drawing = deps
      .layout()
      .pages.flatMap((page) => page.anchoredDrawings ?? [])
      .find((candidate) => candidate.drawingNodeId === scope.drawingNodeId);
    if (
      !story ||
      !drawing?.textboxStory ||
      drawing.transform.rotationDegrees !== 0 ||
      drawing.textboxStory.fragments.some((fragment) => fragment.kind !== 'paragraph')
    )
      return false;
    const first = drawing.textboxStory.fragments[0];
    if (!first || first.kind !== 'paragraph') return false;
    if (active?.id === scope.id) return true;
    exit();
    deps.leaveOtherStories();
    saved = deps.selection();
    active = scope;
    cached = null;
    syncDom();
    const position = { paragraphId: first.paragraphId, offset: first.range.start };
    deps.setSelection({ anchor: position, head: position });
    return true;
  };
  return {
    active: () => active,
    replacementFormatOps(paragraphId: string, offset: number, length: number): TreeDocOp[] {
      const { anchor, head } = deps.selection();
      if (
        !active ||
        length === 0 ||
        (anchor.paragraphId === head.paragraphId && anchor.offset === head.offset)
      )
        return [];
      const properties = authoredRunPropertiesAt(deps.session.part(), paragraphId, offset);
      return properties.length
        ? [{ op: 'setRunProperties', paragraphId, start: offset, end: offset + length, properties }]
        : [];
    },
    enter,
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
    layout(base: SemanticLayout): SemanticLayout {
      if (!active) return base;
      if (cached?.base === base && cached.id === active.id) return cached.layout;
      const id = active.drawingNodeId;
      const layout: SemanticLayout = {
        ...base,
        pages: base.pages.map((page) => {
          const drawing = page.anchoredDrawings?.find(
            (candidate) => candidate.drawingNodeId === id
          );
          const story = drawing?.textboxStory;
          return {
            ...page,
            header: undefined,
            footer: undefined,
            footnotes: undefined,
            endnotes: undefined,
            anchoredDrawings: [],
            fragments:
              drawing && story
                ? story.fragments.flatMap((fragment) =>
                    fragment.kind === 'paragraph'
                      ? [
                          translateParagraphFragment(
                            fragment,
                            drawing.x + story.contentOffset.x,
                            drawing.y + story.contentOffset.y
                          ),
                        ]
                      : []
                  )
                : [],
          };
        }),
      };
      cached = { base, id: active.id, layout };
      return layout;
    },
    preparePointer(element: Element | null): boolean {
      const content = element?.closest('.docx-drawing-textbox-content');
      const id = content?.closest<HTMLElement>('[data-drawing-node-id]')?.dataset.drawingNodeId;
      const story =
        id &&
        textboxStoriesInPart(deps.session.part()).find(
          (candidate) => candidate.drawingNodeId === id
        );
      if (
        story &&
        enter({
          kind: 'frame',
          id: story.root.id,
          drawingNodeId: story.drawingNodeId,
          hostParagraphId: story.hostParagraphId,
        })
      )
        return true;
      exit(false);
      return false;
    },
  };
}
