// Copy, cut and paste of ONE selected drawing that is not a chart: a picture, a shape, a line,
// a text box or a group, DrawingML or legacy VML. Charts copy through `surface-chart-clipboard.ts`, because their parts
// cannot travel in a clipboard fragment.
//
// A selected drawing is a collapsed caret at its anchor, so the range copy finds nothing to
// copy. This lane copies the drawing's one offset unit as an ordinary clipboard fragment
// instead. The paste then takes the ordinary fragment lane: it lands at the caret, gets a fresh
// `wp:docPr` id, keeps its size, formatting and position offsets, and replicates like every
// other rich paste. A paste that lands exactly one drawing selects it, so the copy is ready to
// move.
//
// The copy refuses rather than copying something else: a drawing outside the main story, a
// shape selected inside a group, a drawing whose parts cannot travel (a diagram or an embedded
// object, for example) and a picture too large for the clipboard each name a reason.
//
// Other applications read the interop HTML and the plain text: a text box gives its text, and a
// shape with nothing to show gives nothing rather than an empty paragraph.

import type { TreeApplyResult } from '@docx-editor.dev/core/binding';
import type {
  FragmentCoverage,
  OoxmlNode,
  OoxmlPart,
  StoryScope,
} from '@docx-editor.dev/core/store';
import { findNode, parentNodeOf } from '../store/package/ooxml-edit.ts';
import { isRunLevelMcAlternateContent } from '../store/package/drawing-projection.ts';
import { WML_NAMESPACE_URI, type OoxmlElement } from '../store/package/ooxml-tree.ts';
import { isClipboardObject } from '../store/store/clipboard-object-policy.ts';
import { resolveInternalTarget } from '../store/package/opc-names.ts';
import { relationshipsOf, resolveContentTypeOf } from '../store/package/package-edit.ts';
import type { OoxmlPackage } from '../store/package/ooxml-package.ts';
import { collectRelationshipIds } from '../store/store/clipboard-fragment-closure.ts';
import { paragraphOffsetIndex } from '../store/store/tree-op-segments.ts';
import { buildCopyFlavours, escapeHtml, type CopyFlavours } from './clipboard-copy-payload.ts';
import type { SurfaceClipboardDeps } from './surface-clipboard-ops.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { resolveSelectedDrawingRecord } from './docx-editor-images.ts';
import { selectedGroupMember } from './group-member-selection.ts';

/**
 * The engine's reason for a refused copy, cut or paste of a drawing outside the main story, a
 * text box's own text included. Adapters
 * translate it through `DISABLED_REASON_KEYS` in `@docx-editor.dev/i18n`, so the two sentences
 * must stay the same.
 */
export const DRAWING_CLIPBOARD_STORY_REASON =
  'a drawing can be copied, cut, or pasted only in the main document';

/** Why a copy or cut refuses while a shape inside a group is selected. Translated the same way. */
export const GROUP_MEMBER_CLIPBOARD_REASON =
  'a shape inside a group is copied or cut with its group; press Escape to select the group';

/** Why a copy or cut refuses a drawing whose parts cannot travel. Translated the same way. */
export const DRAWING_CLIPBOARD_PARTS_REASON = 'this drawing uses parts that cannot be copied';

/** Why a copy or cut refuses a picture too large for the clipboard. Translated the same way. */
export const DRAWING_CLIPBOARD_SIZE_REASON = 'this drawing is too large to copy';

/** Why a copied drawing refuses to paste over a cell selection. Translated the same way. */
export const DRAWING_PASTE_CELLS_REASON = 'place the caret in the text to paste a drawing';

/** The attribute that marks the HTML flavour of one copied drawing. */
const DRAWING_COPY_ATTRIBUTE = 'data-docx-editor-drawing';

/** Whether `html` is the HTML flavour of one copied drawing. */
export function isDrawingCopyHtml(html: string | null): boolean {
  return html !== null && html.includes(`${DRAWING_COPY_ATTRIBUTE}="1"`);
}

/** A run-level drawing the clipboard can address: DrawingML, its `mc` wrapper, or VML. */
function isDrawingAtom(node: OoxmlNode): boolean {
  if (node.kind === 'textValue') return false;
  if (node.kind === 'drawing' || isRunLevelMcAlternateContent(node)) return true;
  const element = node as OoxmlElement;
  return element.namespaceUri === WML_NAMESPACE_URI && element.localName === 'pict';
}

/** The paragraph and the offset unit that hold the drawing `drawingNodeId`, or null. */
export function drawingUnitIn(
  part: OoxmlPart,
  drawingNodeId: string
): { readonly paragraphId: string; readonly start: number; readonly end: number } | null {
  const drawing = findNode(part, drawingNodeId);
  if (!drawing || !isDrawingAtom(drawing)) return null;
  for (let node = parentNodeOf(part, drawingNodeId); node; node = parentNodeOf(part, node.id)) {
    if (node.kind !== 'paragraph') continue;
    const span = paragraphOffsetIndex(node).spanOf(drawingNodeId);
    return span && span.end > span.start
      ? { paragraphId: node.id, start: span.start, end: span.end }
      : null;
  }
  return null;
}

/**
 * Whether every part the drawing names can travel in a clipboard fragment. A fragment carries
 * images and external targets only; it drops a drawing that names any other part.
 */
function drawingPartsTravel(pkg: OoxmlPackage, part: OoxmlPart, drawingNodeId: string): boolean {
  const drawing = findNode(part, drawingNodeId);
  if (!drawing) return false;
  const ids = new Set<string>();
  collectRelationshipIds([drawing], ids);
  if (ids.size === 0) return true;
  for (const record of relationshipsOf(pkg, part.name)) {
    if (!ids.has(record.id) || record.targetMode === 'External') continue;
    const resolved = resolveInternalTarget(record.ownerPart, record.rawTarget);
    if (!resolved.ok) return false;
    const type = resolveContentTypeOf(pkg, resolved.partName) ?? '';
    if (!type.toLowerCase().startsWith('image/')) return false;
  }
  return true;
}

/**
 * The selected drawing as the clipboard lanes read it: its node and part, and whether a shape
 * inside it is selected rather than the drawing itself. Null when no drawing is selected.
 */
export function clipboardSelectedDrawing(surface: PaginatedSurface): {
  readonly drawingNodeId: string;
  readonly ownerPartName: string;
  readonly groupMemberSelected: boolean;
} | null {
  const record = resolveSelectedDrawingRecord(surface);
  if (!record) return null;
  return {
    drawingNodeId: record.drawingNodeId,
    ownerPartName: record.ownerPartName,
    groupMemberSelected: selectedGroupMember(surface, record.drawingNodeId) !== null,
  };
}

/** Select a pasted drawing and bring the whole of it into view, as a chart insert does. */
export function selectPastedDrawing(
  surface: PaginatedSurface,
  drawingNodeId: string,
  paragraphId: string
): void {
  if (surface.selectDrawing(drawingNodeId, paragraphId))
    surface.revealPosition(surface.state().selection.head, { block: 'nearest' });
}

const refusal = (reason: string): TreeApplyResult =>
  ({ committed: false, rejected: true, opCount: 0, reason }) as TreeApplyResult;

/** Why the selected drawing cannot be copied, or null when it can. */
export function drawingCopyRefusal(
  session: { part(): OoxmlPart; currentPackage(): OoxmlPackage },
  scope: StoryScope,
  drawing: { readonly drawingNodeId: string; readonly groupMemberSelected?: boolean }
): string | null {
  if (scope.kind !== 'body') return DRAWING_CLIPBOARD_STORY_REASON;
  if (drawing.groupMemberSelected) return GROUP_MEMBER_CLIPBOARD_REASON;
  const part = session.part();
  const node = findNode(part, drawing.drawingNodeId);
  // An embedded object's parts never travel; a chart that its own lane did not take is one too.
  if (!node || isClipboardObject(node)) return DRAWING_CLIPBOARD_PARTS_REASON;
  if (!drawingUnitIn(part, drawing.drawingNodeId)) return DRAWING_CLIPBOARD_STORY_REASON;
  if (!drawingPartsTravel(session.currentPackage(), part, drawing.drawingNodeId))
    return DRAWING_CLIPBOARD_PARTS_REASON;
  return null;
}

/**
 * The flavours of the one selected drawing, or null when the selection is not one drawing. A
 * drawing that cannot be copied publishes its reason and answers flavours that copy nothing.
 */
export function drawingCopyFlavours(deps: SurfaceClipboardDeps): CopyFlavours | null {
  if (deps.cellSelection()) return null;
  const { from, to } = deps.orderedRange();
  if (from.paragraphId !== to.paragraphId || from.offset !== to.offset) return null;
  const drawing = deps.selectedDrawing?.();
  if (!drawing) return null;
  const refused = drawingCopyRefusal(deps.session, deps.storyScope(), drawing);
  const part = deps.session.part();
  const unit = refused ? null : drawingUnitIn(part, drawing.drawingNodeId);
  if (refused || !unit) {
    deps.commit(() => refusal(refused ?? DRAWING_CLIPBOARD_STORY_REASON));
    return { text: '', html: null, reason: 'unsupported-content' };
  }
  // The drawing's own unit, never its paragraph mark: the paste lands inline at the caret.
  const coverage: FragmentCoverage = {
    partName: part.name,
    paragraphIds: [unit.paragraphId],
    startOffset: unit.start,
    endOffset: unit.end,
    coveredParagraphIds: [],
    fullyCoveredBlockIds: [],
    lastMarkCovered: false,
  };
  const text = textBoxTextOf(findNode(part, drawing.drawingNodeId)!);
  const flavours = buildCopyFlavours({
    text,
    cellRectangle: false,
    coverage,
    pkg: deps.session.currentPackage(),
    requireFullFragment: true,
    // Other applications get the text box's text, or a picture, or nothing at all.
    interopHtml: (rendered) =>
      text
        ? text
            .split('\n')
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join('')
        : rendered.includes('<img')
          ? rendered
          : '',
  });
  if (!flavours.html) {
    const reason = flavours.oversized
      ? DRAWING_CLIPBOARD_SIZE_REASON
      : DRAWING_CLIPBOARD_PARTS_REASON;
    deps.commit(() => refusal(reason));
    return { text: '', html: null, reason: 'unsupported-content' };
  }
  // Marked, so a paste where no drawing can land refuses instead of pasting the text alone.
  const html = flavours.html.replace(/^<div /, `<div ${DRAWING_COPY_ATTRIBUTE}="1" `);
  return { text: flavours.text, html, drawingNodeId: drawing.drawingNodeId };
}

/** The drawing that fills the one offset unit ending at `offset`, or null. */
export function drawingEndingAt(
  part: OoxmlPart,
  paragraphId: string,
  offset: number
): string | null {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return null;
  const index = paragraphOffsetIndex(paragraph);
  const pending: OoxmlNode[] = [...paragraph.children];
  while (pending.length) {
    const node = pending.pop()!;
    if (node.kind === 'textValue') continue;
    const span = index.spanOf(node);
    if (!span || span.end < offset || span.start >= offset) continue;
    if (isDrawingAtom(node))
      return span.start === offset - 1 && span.end === offset ? node.id : null;
    for (const child of node.children) pending.push(child);
  }
  return null;
}

/**
 * The text of the text box stories inside a drawing, one line per paragraph, or the empty
 * string. A group copies every box's text, in document order.
 */
function textBoxTextOf(drawing: OoxmlNode): string {
  const lines: string[] = [];
  const visit = (node: OoxmlNode, inBox: boolean): void => {
    if (node.kind === 'textValue') return;
    const element = node as OoxmlElement;
    const box =
      inBox || (element.namespaceUri === WML_NAMESPACE_URI && element.localName === 'txbxContent');
    if (box && node.kind === 'paragraph') {
      lines.push(paragraphPlainText(node));
      return;
    }
    for (const child of node.children) visit(child, box);
  };
  visit(drawing, false);
  return lines.join('\n').trim() === '' ? '' : lines.join('\n');
}

/** A paragraph's run text: `w:t` as written, `w:tab` as a tab, `w:br` as a line break. */
function paragraphPlainText(paragraph: OoxmlNode): string {
  let text = '';
  const visit = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') {
      text += node.value;
      return;
    }
    const element = node as OoxmlElement;
    if (element.namespaceUri === WML_NAMESPACE_URI) {
      if (element.localName === 'tab') text += '\t';
      else if (element.localName === 'br' || element.localName === 'cr') text += '\n';
      // Deleted text, field instructions and nested boxes are not this paragraph's text.
      if (['delText', 'instrText', 'del', 'txbxContent'].includes(element.localName)) return;
    }
    for (const child of node.children) visit(child);
  };
  if (paragraph.kind !== 'textValue') for (const child of paragraph.children) visit(child);
  return text;
}
