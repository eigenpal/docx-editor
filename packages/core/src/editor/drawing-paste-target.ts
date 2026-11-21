// Where a paste goes while a drawing is selected: the ONE answer every paste lane asks, plain
// text, HTML, an editor fragment, a copied drawing or chart, and a picture file alike.
//
// A selected drawing is a collapsed caret at the start of its anchor run. Content goes there,
// immediately before the anchor run, in the anchor paragraph: a copied drawing or a picture
// always, and text while a picture, a chart, a line, a whole group or a drawing canvas is
// selected. The selected drawing stays where it is.
//
// Text pasted while a shape that can hold text is selected goes into the shape instead, and
// replaces the text it holds. The editor writes it into the shape's text box story. A shape
// with no text box story, a text box whose text cannot take a caret, a linked text box, and a
// shape selected inside a group refuse with a reason, so the text never lands somewhere the
// reader did not choose. Pasted content that holds a picture refuses on a text box, which
// takes only text, instead of dropping the picture.
//
// A shape with no text box story refuses, and gets no new text body: no released tree
// operation adds a `wps:txbx` or a `v:textbox` to an existing shape. Deleting the shape and
// inserting a copy with a text body would change its identity under a collaborator's edits,
// and a tracked drawing deletion is refused. The automation API refuses the same write
// (`empty-text-frame.ts`).

import type { OoxmlNode } from '@docx-editor.dev/core/store';
import type { CanResult, EditorCommand } from '../contracts/editor.ts';
import { readOoxmlPackage } from '../store/package/ooxml-package.ts';
import { fragmentFromHtml } from './clipboard-fragment-codec.ts';
import { projectExternalHtml } from './clipboard-html-read.ts';
import { htmlHasVisibleText } from './clipboard-plain-text.ts';
import { chartClipboardToken } from './chart-clipboard.ts';
import { findNode } from '../store/package/ooxml-edit.ts';
import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import { DRAWINGML_MAIN_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { WPS_NAMESPACE_URI } from '../store/package/ooxml-drawing-rules.ts';
import { WPG_NAMESPACE_URI } from '../store/package/drawing-group-frame.ts';
import { WPC_NAMESPACE_URI } from '../store/package/drawing-canvas-projection.ts';
import { VML, attribute } from '../store/package/legacy-vml-values.ts';
import { textboxStoriesInPart } from '../store/package/textbox-stories.ts';
import { paragraphLength } from '../store/store/tree-op-segments.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { resolveSelectedDrawingRecord } from './selected-drawing-record.ts';
import { selectedGroupMember } from './group-member-selection.ts';
import { textboxTakesCaret } from './textbox-caret-rules.ts';
import { partOfNodeId } from './surface-scope.ts';
import type { createTextboxEditing } from './surface-textbox-editing.ts';
import type { SurfaceClipboardDeps } from './surface-clipboard-ops.ts';
import {
  GROUP_MEMBER_PASTE_REASON,
  LINKED_TEXT_BOX_PASTE_REASON,
  SHAPE_PASTE_TEXT_REASON,
  TEXT_BOX_PASTE_REASON,
  TEXT_BOX_PICTURE_PASTE_REASON,
  clipboardSelectedDrawing,
  isDrawingCopyHtml,
  selectPastedDrawing,
} from './surface-drawing-clipboard.ts';

/** What a paste carries: text (plain, HTML or a fragment), or a drawing or picture. */
export type DrawingPasteContent = 'text' | 'drawing';

/** Where a paste goes while a drawing is selected. */
export type DrawingPasteTarget =
  /** Immediately before the selected drawing's anchor run, in its anchor paragraph. */
  | { readonly kind: 'anchor'; readonly paragraphId: string; readonly offset: number }
  /** Into the selected shape's text box story, replacing its text. */
  | { readonly kind: 'textBox'; readonly drawingNodeId: string }
  /** Nowhere: the paste refuses with this reason. */
  | { readonly kind: 'refused'; readonly reason: string };

/** Connector and line geometries, which hold no text. */
const LINE_GEOMETRY = /^(?:line|straightConnector1|(?:bent|curved)Connector[2-5])$/;

/** Markup compatibility, whose `mc:Fallback` repeats the `mc:Choice` content. */
const MC_NAMESPACE_URI = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

type DrawingTextKind = 'group' | 'line' | 'shape' | 'linked' | 'other';

const childNamed = (node: OoxmlNode, namespaceUri: string, localName: string) =>
  node.kind === 'textValue'
    ? undefined
    : node.children.find(
        (child) =>
          child.kind !== 'textValue' &&
          (child as OoxmlElement).namespaceUri === namespaceUri &&
          (child as OoxmlElement).localName === localName
      );

/** A DrawingML shape: a line, a shape in a text chain, or a shape that can hold text. */
function shapeKind(shape: OoxmlNode): DrawingTextKind {
  if (childNamed(shape, WPS_NAMESPACE_URI, 'cNvCnPr')) return 'line';
  if (childNamed(shape, WPS_NAMESPACE_URI, 'linkedTxbx')) return 'linked';
  const properties = childNamed(shape, WPS_NAMESPACE_URI, 'spPr');
  const geometry = properties && childNamed(properties, DRAWINGML_MAIN_NAMESPACE_URI, 'prstGeom');
  const preset = geometry ? attribute(geometry as OoxmlElement, 'prst') : undefined;
  return preset !== undefined && LINE_GEOMETRY.test(preset) ? 'line' : 'shape';
}

/** A legacy VML shape: a group, a line, a picture, or a shape that can hold text. */
function vmlKind(element: OoxmlElement): DrawingTextKind | null {
  switch (element.localName) {
    case 'group':
      return 'group';
    case 'line':
    case 'polyline':
    case 'arc':
      return 'line';
    case 'shape':
    case 'rect':
    case 'roundrect':
    case 'oval':
      return childNamed(element, VML, 'imagedata') ? 'other' : 'shape';
    default:
      return null;
  }
}

/** What the outermost graphic of a drawing is, as far as pasted text is concerned. */
function drawingTextKind(drawing: OoxmlNode): DrawingTextKind {
  // Breadth first, with a read index rather than `shift`, which moves every queued node.
  const pending: OoxmlNode[] = [drawing];
  for (let next = 0; next < pending.length; next++) {
    const node = pending[next]!;
    if (node.kind === 'textValue') continue;
    const element = node as OoxmlElement;
    if (element.namespaceUri === MC_NAMESPACE_URI && element.localName === 'Fallback') continue;
    if (element.namespaceUri === WML_NAMESPACE_URI && element.localName === 'txbxContent') continue;
    if (element.namespaceUri === WPG_NAMESPACE_URI && element.localName === 'wgp') return 'group';
    // A drawing canvas holds its shapes as a group does: text goes beside it, not into one.
    if (element.namespaceUri === WPC_NAMESPACE_URI && element.localName === 'wpc') return 'group';
    if (element.namespaceUri === WPS_NAMESPACE_URI && element.localName === 'wsp')
      return shapeKind(element);
    if (element.namespaceUri === VML) {
      const kind = vmlKind(element);
      if (kind) return kind;
    }
    for (const child of node.children) pending.push(child);
  }
  return 'other';
}

/**
 * The selected drawing and the point immediately before its anchor run, or null when none is
 * selected or the document is open for viewing. The point comes from the drawing, not the
 * caret: a press on the right half of an inline drawing leaves the caret after it.
 */
function selectedDrawingAt(surface: PaginatedSurface) {
  if (surface.editingMode() === 'view') return null;
  const record = resolveSelectedDrawingRecord(surface);
  if (!record) return null;
  const paragraphId = 'anchorParagraphId' in record ? record.anchorParagraphId : record.paragraphId;
  return { record, point: { paragraphId, offset: record.start } } as const;
}

/**
 * Where a pasted drawing or picture goes while a drawing is selected: immediately before the
 * selected drawing's anchor run. Null when no drawing is selected or the document is open for
 * viewing. The same point `drawingPasteTarget` gives for drawing content.
 */
export function drawingPastePoint(
  surface: PaginatedSurface
): { readonly paragraphId: string; readonly offset: number } | null {
  return selectedDrawingAt(surface)?.point ?? null;
}

/**
 * Where a paste of `content` goes while a drawing is selected, or null when no drawing is
 * selected or the document is open for viewing. Every paste lane asks this before it lands.
 */
export function drawingPasteTarget(
  surface: PaginatedSurface,
  content: DrawingPasteContent
): DrawingPasteTarget | null {
  const selected = selectedDrawingAt(surface);
  if (!selected) return null;
  const { record } = selected;
  const atAnchor: DrawingPasteTarget = { kind: 'anchor', ...selected.point };
  if (content === 'drawing') return atAnchor;
  const part = partOfNodeId(surface.session, record.drawingNodeId) ?? surface.session.part();
  const drawing = findNode(part, record.drawingNodeId);
  const kind = drawing ? drawingTextKind(drawing) : 'other';
  if (kind === 'group' && selectedGroupMember(surface, record.drawingNodeId) !== null)
    return { kind: 'refused', reason: GROUP_MEMBER_PASTE_REASON };
  if (kind === 'linked') return { kind: 'refused', reason: LINKED_TEXT_BOX_PASTE_REASON };
  if (kind !== 'shape') return atAnchor;
  const story = textboxStoriesInPart(part).find(
    (candidate) => candidate.drawingNodeId === record.drawingNodeId
  );
  if (!story) return { kind: 'refused', reason: SHAPE_PASTE_TEXT_REASON };
  if (!textboxTakesCaret(part, story.root.id, record))
    return { kind: 'refused', reason: TEXT_BOX_PASTE_REASON };
  return { kind: 'textBox', drawingNodeId: record.drawingNodeId };
}

/**
 * Enter the text box of the selected drawing and select all of its text, so the paste that
 * follows replaces it. False when the box cannot be entered.
 */
export function selectTextBoxForPaste(
  surface: PaginatedSurface,
  textbox: ReturnType<typeof createTextboxEditing> | null,
  drawingNodeId: string
): boolean {
  const anchorParagraphId = surface.state().selection.anchor.paragraphId;
  if (!textbox?.enterDrawing(drawingNodeId)) return false;
  const ids = textbox.paragraphIds();
  const first = ids[0];
  const last = ids[ids.length - 1];
  const part = partOfNodeId(surface.session, last) ?? surface.session.part();
  const paragraph = last === undefined ? null : findNode(part, last);
  if (first === undefined || last === undefined || paragraph?.kind !== 'paragraph') {
    // Leave the box and select the drawing again, so the refusal shows what refused.
    textbox.exit();
    surface.selectDrawing(drawingNodeId, anchorParagraphId);
    return false;
  }
  surface.setSelection({
    anchor: { paragraphId: first, offset: 0 },
    head: { paragraphId: last, offset: paragraphLength(paragraph) },
  });
  return true;
}

/**
 * The kind of content a paste carries. A copied drawing places as a drawing, and so does a
 * payload with no visible text in either flavour but a picture, which never empties a text
 * box it does not fill. Visible text in the plain or the HTML flavour is text, and so is a
 * lone line break or tab: it replaces the text of a selected text box.
 */
export function pasteContentOf(
  text: string,
  html: string | null,
  drawingCopy: boolean
): DrawingPasteContent {
  if (drawingCopy) return 'drawing';
  if (text.trim() !== '' || (html !== null && htmlHasVisibleText(html))) return 'text';
  if (text === '') return 'drawing';
  return pasteHtmlHoldsDrawing(html) ? 'drawing' : 'text';
}

/** A run-level drawing in a fragment: DrawingML, or a legacy VML picture or shape. */
function isDrawingNode(node: OoxmlNode): boolean {
  if (node.kind === 'drawing') return true;
  const element = node as OoxmlElement;
  return element.namespaceUri === WML_NAMESPACE_URI && element.localName === 'pict';
}

/**
 * Whether pasted HTML carries a picture or a drawing: an editor fragment that holds one, or
 * external HTML whose projection keeps an image. A text box takes only text, so such a paste
 * refuses there rather than drop the picture. An embedded object (`w:object`) is not counted:
 * the paste router refuses it on every lane already.
 */
export function pasteHtmlHoldsDrawing(html: string | null): boolean {
  if (!html) return false;
  const embedded = fragmentFromHtml(html);
  if (!embedded) {
    const projected = projectExternalHtml(html);
    return projected.ok && projected.imageCount > 0;
  }
  const read = readOoxmlPackage(embedded.bytes);
  if (!read.ok) return false;
  const pending: OoxmlNode[] = [...read.package.parts.values()].map((part) => part.root);
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'textValue') continue;
    if (isDrawingNode(node)) return true;
    pending.push(...node.children);
  }
  return false;
}

/**
 * Where one paste payload goes while a drawing is selected, or null when none is selected.
 * `html` is null for a plain paste. A text box refuses HTML that holds a picture.
 */
export function pasteTargetOf(
  surface: PaginatedSurface,
  text: string,
  html: string | null,
  drawingCopy: boolean
): DrawingPasteTarget | null {
  // No drawing selected: no payload work at all.
  if (!selectedDrawingAt(surface)) return null;
  const target = drawingPasteTarget(surface, pasteContentOf(text, html, drawingCopy));
  return target?.kind === 'textBox' && pasteHtmlHoldsDrawing(html)
    ? { kind: 'refused', reason: TEXT_BOX_PICTURE_PASTE_REASON }
    : target;
}

/**
 * Why a paste command cannot land while a drawing is selected, or null when it can. `can` asks
 * it when the command names its payload, so a host that knows what it pastes learns the
 * reason before it runs the paste. The paste itself asks `pasteTargetOf` again and publishes
 * the same reason.
 *
 * A probe with no payload, whitespace text and no HTML, never refuses here: where it goes
 * depends on what the clipboard holds. A copied drawing still lands before the anchor of a
 * shape that refuses text. The Paste controls probe with a single space for this reason, and
 * the paste refuses after the clipboard read when its payload has no place.
 */
export function drawingPasteRefusal(
  surface: PaginatedSurface,
  command: EditorCommand
): CanResult | null {
  if (command.type !== 'paste' && command.type !== 'pasteWithoutFormatting') return null;
  const html = command.type === 'paste' ? (command.html ?? null) : null;
  if (!html && command.text.trim() === '') return null;
  // A copied chart carries its name as text, but it pastes where a drawing does.
  const drawingCopy = isDrawingCopyHtml(html) || chartClipboardToken(html) !== null;
  const target = pasteTargetOf(surface, command.text, html, drawingCopy);
  return target?.kind === 'refused'
    ? { ok: false, code: 'unsupported', reason: target.reason }
    : null;
}

/**
 * The drawing hooks the clipboard lanes take from the surface, in one place. The argument is a
 * getter: the lanes are made before the surface object exists.
 */
export function drawingClipboardDeps(
  mount: () => {
    readonly surface: PaginatedSurface;
    readonly textbox: ReturnType<typeof createTextboxEditing> | null;
  }
): Pick<
  SurfaceClipboardDeps,
  | 'selectedDrawing'
  | 'selectPastedDrawing'
  | 'drawingPasteTarget'
  | 'selectTextBoxForPaste'
  | 'leaveTextBoxForPaste'
  | 'placeCaretForPaste'
> {
  const surface = () => mount().surface;
  return {
    selectedDrawing: () => clipboardSelectedDrawing(surface()),
    selectPastedDrawing: (id, paragraphId) => selectPastedDrawing(surface(), id, paragraphId),
    drawingPasteTarget: (text, html, drawingCopy) =>
      pasteTargetOf(surface(), text, html, drawingCopy),
    selectTextBoxForPaste: (id) => selectTextBoxForPaste(surface(), mount().textbox, id),
    placeCaretForPaste: (paragraphId, offset) => {
      const record = resolveSelectedDrawingRecord(surface());
      const at = { paragraphId, offset };
      surface().setSelection({ anchor: at, head: at });
      return record ? () => surface().selectDrawing(record.drawingNodeId, paragraphId) : null;
    },
    leaveTextBoxForPaste: (id, paragraphId) => {
      mount().textbox?.exit();
      surface().selectDrawing(id, paragraphId);
    },
  };
}
