// Content-control query derivation for the Editor facade.
//
// Projects typed `w:sdt` nodes — and generic WML `sdt` fallbacks until the canonical model
// lands — into `ContentControlSummary` values. Foreign-namespace `<x:sdt>` elements stay
// opaque and are never enumerated. `contentControls` lists every Word control in reading
// order; `contentControlAt` resolves the innermost control at the caret using inline UTF-16
// ranges first (half-open `[start, end)` affinity), then block-ancestor fallback.

import type {
  CanResult,
  DocTarget,
  EditorScope,
  ExecErrorCode,
  ExecResult,
} from '@docx-editor.dev/core/contracts/editor';
import type { ContentControlFilter, ContentControlType } from '../contracts/types.ts';
import type { ContentControlSummary } from '../contracts/document.ts';
import type { DocAnchor, DocLocation, DocRange } from '../contracts/types.ts';
import {
  WML_NAMESPACE_URI,
  contentControlContentChildren,
  findNode,
  isContentControl,
  parentNodeOf,
  validateTreeOp,
  type OoxmlContentControlNode,
  type OoxmlElement,
  type OoxmlGenericElementNode,
  type OoxmlNode,
  type OoxmlPart,
  type TreeDocOp,
} from '@docx-editor.dev/core/store';
import type { ParagraphAnchorIndex } from '../binding/paragraph-anchors.ts';
import { isDocAnchor, resolveDocAnchor } from './anchor-resolution.ts';
import type { PaginatedSurface } from './paginated-surface-contract.ts';
import { selectionMarkOf } from './surface-selection-ops.ts';

const W14_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2010/wordml';
const W15_NAMESPACE_URI = 'http://schemas.microsoft.com/office/word/2012/wordml';

/** Nested inline control depth bound — matches layout `MAX_SDT_NESTING`. */
const MAX_SDT_NESTING = 32;

type ContentControlLike = OoxmlContentControlNode | OoxmlGenericElementNode;

/** Shared walk predicate — WML namespace required for generic `sdt` fallback. */
function isContentControlNode(node: OoxmlNode): node is ContentControlLike {
  return isContentControl(node);
}

function elementChildren(node: OoxmlNode): readonly OoxmlNode[] {
  return node.kind === 'textValue' ? [] : node.children;
}

/**
 * Characters one inline node contributes to paragraph UTF-16 offsets.
 *
 * Mirrors the store segment model and the layout inline projection: text counts code units,
 * `w:tab` and `w:br` count one, properties and unmodelled generic nodes count nothing, and
 * inline controls flatten transparently through their `w:sdtContent`.
 */
function addressableLength(node: OoxmlNode): number {
  if (node.kind === 'textValue') return node.value.length;
  if (node.kind === 'tab' || node.kind === 'hardBreak') return 1;
  if (node.kind === 'runProperties' || node.kind === 'generic') return 0;
  if (isContentControlNode(node)) {
    let total = 0;
    for (const inner of contentControlContentChildren(node)) total += addressableLength(inner);
    return total;
  }
  let total = 0;
  for (const child of elementChildren(node)) total += addressableLength(child);
  return total;
}

function propertiesOf(control: OoxmlElement): OoxmlElement | undefined {
  for (const child of control.children) {
    if (child.kind === 'textValue') continue;
    if ((child as { kind: string }).kind === 'contentControlProperties') return child;
    if (child.localName === 'sdtPr') return child;
  }
  return undefined;
}

function wmlVal(node: OoxmlNode): string | undefined {
  if (node.kind === 'textValue') return undefined;
  for (const attribute of node.attributes) {
    if (attribute.localName === 'val' && attribute.namespaceUri === WML_NAMESPACE_URI) {
      return attribute.value;
    }
  }
  return undefined;
}

function childVal(properties: OoxmlElement | undefined, localName: string): string | undefined {
  if (!properties) return undefined;
  for (const child of properties.children) {
    if (child.kind === 'textValue') continue;
    if (child.localName === localName) return wmlVal(child);
  }
  return undefined;
}

function controlTypeOf(properties: OoxmlElement | undefined): ContentControlType {
  if (!properties) return 'richText';
  for (const child of properties.children) {
    if (child.kind === 'textValue') continue;
    const mapped = mapTypeMarker(child);
    if (mapped !== undefined) return mapped;
  }
  return 'richText';
}

function mapTypeMarker(node: OoxmlNode): ContentControlType | undefined {
  if (node.kind === 'textValue') return undefined;
  const kind = node.kind;
  const localName = node.localName;
  const namespaceUri = node.namespaceUri;

  if (kind === 'contentControlDropDownList' || localName === 'dropDownList') {
    return 'dropdown';
  }
  if (kind === 'contentControlComboBox' || localName === 'comboBox') {
    return 'comboBox';
  }
  if (kind === 'contentControlDate' || localName === 'date') return 'date';
  if (localName === 'picture') return 'picture';
  if (kind === 'contentControlText' || localName === 'text') return 'plainText';
  if (localName === 'richText') return 'richText';

  if (
    localName === 'checkbox' &&
    (namespaceUri === W14_NAMESPACE_URI || kind === 'contentControlCheckbox')
  ) {
    return 'checkbox';
  }
  if (localName === 'repeatingSection' && namespaceUri === W15_NAMESPACE_URI) {
    return 'repeatingSection';
  }

  return undefined;
}

/** Declared content-edit lock on one control (`contentLocked` / `sdtContentLocked`). */
function contentEditingLocked(properties: OoxmlElement | undefined): boolean {
  const lock = childVal(properties, 'lock');
  return lock === 'contentLocked' || lock === 'sdtContentLocked';
}

/**
 * Effective content-edit lock — nested union matching store `effectiveLockOf` content axis.
 * An unlocked inner under a `contentLocked` outer is still locked for editing.
 */
function effectiveContentLocked(part: OoxmlPart, control: OoxmlElement): boolean {
  if (contentEditingLocked(propertiesOf(control))) return true;
  let current = parentNodeOf(part, control.id);
  while (current) {
    if (isContentControlNode(current) && contentEditingLocked(propertiesOf(current))) {
      return true;
    }
    current = parentNodeOf(part, current.id);
  }
  return false;
}

/**
 * Project a control into a public summary.
 *
 * When `part` is provided, `locked` is the nested content-edit union so an unlocked inner
 * under a `contentLocked` outer reports `locked: true`. Without a part (unit mocks), fall
 * back to the control's own declaration.
 */
function summaryOf(control: OoxmlElement, part?: OoxmlPart): ContentControlSummary {
  const properties = propertiesOf(control);
  const tag = childVal(properties, 'tag');
  const alias = childVal(properties, 'alias');
  const locked = part ? effectiveContentLocked(part, control) : contentEditingLocked(properties);
  return {
    id: control.id,
    controlType: controlTypeOf(properties),
    ...(tag !== undefined ? { tag } : {}),
    ...(alias !== undefined ? { alias } : {}),
    ...(locked ? { locked: true } : {}),
  };
}

function matchesFilter(summary: ContentControlSummary, filter?: ContentControlFilter): boolean {
  if (!filter) return true;
  if (filter.tag !== undefined && summary.tag !== filter.tag) return false;
  if (filter.alias !== undefined && summary.alias !== filter.alias) return false;
  if (filter.controlType !== undefined && summary.controlType !== filter.controlType) return false;
  return true;
}

type InlineControlRange = {
  readonly control: OoxmlElement;
  readonly start: number;
  readonly end: number;
  readonly depth: number;
};

/**
 * Every inline control's UTF-16 span inside one paragraph.
 *
 * Affinity at boundaries is half-open: a caret at `start` is inside, at `end` is outside. When
 * nested controls share an edge, the inner control yields at its exclusive end so the outer
 * control owns that offset.
 */
function inlineControlRangesOf(paragraph: OoxmlElement): InlineControlRange[] {
  const ranges: InlineControlRange[] = [];

  const walk = (
    children: readonly OoxmlNode[],
    offset: number,
    depth: number,
    sdtDepth: number
  ): number => {
    let position = offset;
    for (const child of children) {
      if (child.kind === 'paragraphProperties') continue;
      if (child.kind === 'run') {
        position += addressableLength(child);
        continue;
      }
      if (child.kind === 'hyperlink') {
        position = walk(child.children, position, depth, sdtDepth);
        continue;
      }
      if (isContentControlNode(child) && sdtDepth < MAX_SDT_NESTING) {
        const start = position;
        const nextDepth = depth + 1;
        position = walk(contentControlContentChildren(child), position, nextDepth, sdtDepth + 1);
        ranges.push({ control: child, start, end: position, depth: nextDepth });
        continue;
      }
      position += addressableLength(child);
    }
    return position;
  };

  walk(paragraph.children, 0, -1, 0);
  return ranges;
}

function inlineControlsContaining(
  paragraph: OoxmlElement,
  offset: number,
  part?: OoxmlPart
): readonly ContentControlSummary[] {
  return inlineControlRangesOf(paragraph)
    .filter((range) => offset >= range.start && offset < range.end)
    .sort((left, right) => right.depth - left.depth)
    .map((range) => summaryOf(range.control, part));
}

function collectContentControls(part: OoxmlPart): ContentControlSummary[] {
  const controls: ContentControlSummary[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (isContentControlNode(node)) {
      controls.push(summaryOf(node, part));
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return controls;
}

function blockAncestorsOf(part: OoxmlPart, paragraphId: string): ContentControlSummary[] {
  const ancestors: ContentControlSummary[] = [];
  let current = parentNodeOf(part, paragraphId);
  while (current) {
    if (isContentControlNode(current)) {
      ancestors.push(summaryOf(current, part));
    }
    current = parentNodeOf(part, current.id);
  }
  return ancestors.reverse();
}

/** The `contentControls` query — every control in the loaded body part, optionally filtered. */
export function contentControlsOf(
  surface: PaginatedSurface | null,
  filter?: ContentControlFilter
): readonly ContentControlSummary[] {
  if (!surface) return [];
  return collectContentControls(surface.session.part()).filter((summary) =>
    matchesFilter(summary, filter)
  );
}

/**
 * The `contentControlAt` query — the innermost control at the caret.
 *
 * Inline controls along the paragraph's UTF-16 offset win over block ancestors. Among inline
 * controls, the deepest range containing the offset wins; when a filter is present, the
 * innermost matching candidate is returned, which may be an outer wrapper when the inner one
 * does not match.
 */
export function contentControlAtOf(
  surface: PaginatedSurface | null,
  filter?: ContentControlFilter
): ContentControlSummary | null {
  if (!surface) return null;
  const part = surface.session.part();
  const { paragraphId, offset } = surface.state().selection.head;
  const paragraph = findNode(part, paragraphId);
  if (paragraph && paragraph.kind === 'paragraph') {
    for (const summary of inlineControlsContaining(paragraph, offset, part)) {
      if (matchesFilter(summary, filter)) return summary;
    }
  }
  const ancestors = blockAncestorsOf(part, paragraphId);
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const summary = ancestors[index]!;
    if (matchesFilter(summary, filter)) return summary;
  }
  return null;
}

/** Exported for focused unit tests over mock typed nodes. */
export function contentControlSummaryOf(node: OoxmlElement): ContentControlSummary {
  return summaryOf(node);
}

/** Exported for focused unit tests over inline UTF-16 affinity. */
export function inlineContentControlsAt(
  paragraph: OoxmlElement,
  offset: number
): readonly ContentControlSummary[] {
  return inlineControlsContaining(paragraph, offset);
}

// ─── Command dispatch ────────────────────────────────────────────────────────

export type ContentControlEditorCommand =
  | { type: 'setContentControlValue'; target?: DocTarget; value: string }
  | { type: 'removeContentControl'; target?: DocTarget };

export function isContentControlEditorCommand(command: {
  type: string;
}): command is ContentControlEditorCommand {
  return command.type === 'setContentControlValue' || command.type === 'removeContentControl';
}

type CommandGate = { ok: true } | { ok: false; refusal: Extract<ExecResult, { ok: false }> };

type TargetResolution =
  | { ok: true; controlId: string }
  | { ok: false; code: ExecErrorCode; reason: string; target?: DocTarget };

function isDocLocation(value: DocTarget): value is DocLocation {
  return typeof value === 'object' && value !== null && 'container' in value && 'path' in value;
}

function isDocRange(value: DocTarget): value is DocRange {
  return typeof value === 'object' && value !== null && 'from' in value && 'to' in value;
}

function bodyOf(part: OoxmlPart): OoxmlElement | null {
  const walk = (node: OoxmlNode): OoxmlElement | null => {
    if (node.kind === 'textValue') return null;
    if (node.kind === 'body') return node;
    for (const child of node.children) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  };
  return walk(part.root);
}

/** Direct block children at one container level — paragraphs, tables, and controls as siblings. */
function directFlowBlocks(children: readonly OoxmlNode[]): OoxmlElement[] {
  const blocks: OoxmlElement[] = [];
  for (const child of children) {
    if (child.kind === 'textValue') continue;
    if (child.kind === 'paragraph' || child.kind === 'table' || isContentControlNode(child)) {
      blocks.push(child);
    }
  }
  return blocks;
}

/** Table cell blocks in reading order — the next path level when descending into a table. */
function tableCellBlocks(table: OoxmlElement): OoxmlElement[] {
  const blocks: OoxmlElement[] = [];
  for (const row of table.children) {
    if (row.kind !== 'tableRow') continue;
    for (const cell of row.children) {
      if (cell.kind !== 'tableCell') continue;
      blocks.push(...directFlowBlocks(cell.children));
    }
  }
  return blocks;
}

function blocksOf(node: OoxmlElement): OoxmlElement[] {
  if (node.kind === 'table') return tableCellBlocks(node);
  if (isContentControlNode(node)) return directFlowBlocks(contentControlContentChildren(node));
  if (node.kind === 'body') return directFlowBlocks(node.children);
  return [];
}

function controlAtBlock(part: OoxmlPart, node: OoxmlElement, offset?: number): TargetResolution {
  if (isContentControlNode(node)) {
    return { ok: true, controlId: node.id };
  }
  if (node.kind === 'paragraph') {
    const caretOffset = offset ?? 0;
    for (const summary of inlineControlsContaining(node, caretOffset, part)) {
      return { ok: true, controlId: summary.id };
    }
    const ancestors = blockAncestorsOf(part, node.id);
    const innermost = ancestors.at(-1);
    if (innermost) return { ok: true, controlId: innermost.id };
  }
  return { ok: false, code: 'notFound', reason: 'no content control at the addressed block' };
}

function resolveDocLocationControl(part: OoxmlPart, location: DocLocation): TargetResolution {
  if (location.container.part !== 'body') {
    return {
      ok: false,
      code: 'unsupported',
      reason: 'only the body container is supported',
      target: location,
    };
  }
  const body = bodyOf(part);
  if (!body) {
    return {
      ok: false,
      code: 'notFound',
      reason: 'the document body was not found',
      target: location,
    };
  }
  if (location.path.length === 0) {
    return { ok: false, code: 'notFound', reason: 'DocLocation path is empty', target: location };
  }
  let blocks = directFlowBlocks(body.children);
  let node: OoxmlElement | null = null;
  for (let index = 0; index < location.path.length; index += 1) {
    node = blocks[location.path[index]!] ?? null;
    if (!node) {
      return {
        ok: false,
        code: 'notFound',
        reason: `block index ${location.path[index]} is out of range`,
        target: location,
      };
    }
    if (index < location.path.length - 1) {
      blocks = blocksOf(node);
    }
  }
  if (!node) {
    return {
      ok: false,
      code: 'notFound',
      reason: 'the addressed block was not found',
      target: location,
    };
  }
  const resolved = controlAtBlock(part, node, location.offset);
  return resolved.ok ? resolved : { ...resolved, target: location };
}

function resolveDocAnchorControl(
  part: OoxmlPart,
  anchors: ParagraphAnchorIndex,
  anchor: DocAnchor
): TargetResolution {
  const resolved = resolveDocAnchor(part, anchors, anchor);
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, reason: resolved.reason, target: anchor };
  }
  const paragraph = findNode(part, resolved.span.nodeId);
  if (!paragraph || paragraph.kind !== 'paragraph') {
    return {
      ok: false,
      code: 'notFound',
      reason: `paragraph '${anchor.paraId}' was not found`,
      target: anchor,
    };
  }
  const atOffset = resolved.span.start;
  for (const summary of inlineControlsContaining(paragraph, atOffset, part)) {
    return { ok: true, controlId: summary.id };
  }
  const ancestors = blockAncestorsOf(part, paragraph.id);
  const innermost = ancestors.at(-1);
  if (innermost) return { ok: true, controlId: innermost.id };
  return {
    ok: false,
    code: 'notFound',
    reason: `no content control encloses paragraph '${anchor.paraId}'`,
    target: anchor,
  };
}

/** Resolve a public `DocTarget` (or the caret) to canonical control node identity. */
export function resolveContentControlTarget(
  surface: PaginatedSurface,
  target?: DocTarget
): TargetResolution {
  if (target === undefined) {
    const at = contentControlAtOf(surface);
    if (!at) {
      return { ok: false, code: 'notFound', reason: 'no content control at the current selection' };
    }
    return { ok: true, controlId: at.id };
  }
  if (isDocRange(target)) {
    return {
      ok: false,
      code: 'unsupported',
      reason: 'DocRange targeting is not supported for content controls',
      target,
    };
  }
  const part = surface.session.part();
  if (isDocLocation(target)) return resolveDocLocationControl(part, target);
  if (isDocAnchor(target)) {
    return resolveDocAnchorControl(part, surface.session.paragraphAnchors(), target);
  }
  return { ok: false, code: 'invalidArgs', reason: 'unrecognized target shape', target };
}

function mapTreeOpRejection(reason: string): ExecErrorCode {
  switch (reason) {
    case 'locked':
    case 'bound':
    case 'typeMismatch':
    case 'invalidArgs':
    case 'unsupported':
      return reason;
    case 'unknown-control':
      return 'notFound';
    default:
      return 'unsupported';
  }
}

function treeOpRejectionMessage(reason: string): string {
  switch (reason) {
    case 'locked':
      return 'the content control is locked';
    case 'bound':
      return 'the content control is bound to external data';
    case 'typeMismatch':
      return 'the value does not match the control type';
    case 'invalidArgs':
      return 'the value is not valid for this control';
    case 'unsupported':
      return 'this control type is not supported';
    case 'unknown-control':
      return 'the content control was not found';
    default:
      return `the edit was refused (${reason})`;
  }
}

function treeOpRejectionToExecResult(
  reason: string,
  target?: DocTarget
): Extract<ExecResult, { ok: false }> {
  return {
    ok: false,
    code: mapTreeOpRejection(reason),
    reason: treeOpRejectionMessage(reason),
    ...(target !== undefined ? { target } : {}),
  };
}

function gateContentControlCommand(
  command: ContentControlEditorCommand,
  surface: PaginatedSurface | null,
  mode: 'edit' | 'view' | 'suggesting',
  options?: { scope?: EditorScope }
): CommandGate {
  if (options?.scope && options.scope.kind !== 'body') {
    return {
      ok: false,
      refusal: { ok: false, code: 'unsupported', reason: 'only the body scope is supported' },
    };
  }
  if (!surface) {
    return { ok: false, refusal: { ok: false, code: 'notFound', reason: 'no document is loaded' } };
  }
  if (mode === 'view' || !surface.session.editable) {
    return {
      ok: false,
      refusal: { ok: false, code: 'locked', reason: 'the document is read-only' },
    };
  }
  if (command.type === 'setContentControlValue' && typeof command.value !== 'string') {
    return {
      ok: false,
      refusal: {
        ok: false,
        code: 'invalidArgs',
        reason: 'setContentControlValue requires a string value',
      },
    };
  }
  return { ok: true };
}

/**
 * `can` probe for content-control commands.
 *
 * Faithfully predicts `exec`: after shape/mode/target gates, runs the same `validateTreeOp`
 * the store would apply for lock, binding, type, and value — so chrome/`Editor.can` never
 * claim a command is executable when `exec` would refuse it.
 */
export function canContentControlCommand(
  command: ContentControlEditorCommand,
  surface: PaginatedSurface | null,
  mode: 'edit' | 'view' | 'suggesting',
  options?: { scope?: EditorScope }
): CanResult {
  const gated = gateContentControlCommand(command, surface, mode, options);
  if (!gated.ok) return gated.refusal;
  const resolved = resolveContentControlTarget(surface!, command.target);
  if (!resolved.ok) {
    return { ok: false, code: resolved.code, reason: resolved.reason };
  }
  const op: TreeDocOp =
    command.type === 'setContentControlValue'
      ? { op: 'setContentControlValue', controlId: resolved.controlId, value: command.value }
      : { op: 'removeContentControl', controlId: resolved.controlId };
  const rejection = validateTreeOp(surface!.session.part(), op);
  if (rejection) {
    return {
      ok: false,
      code: mapTreeOpRejection(rejection),
      reason: treeOpRejectionMessage(rejection),
    };
  }
  return { ok: true };
}

/** Commit a content-control tree op through the surface session and refresh layout. */
export function execContentControlCommand(
  surface: PaginatedSurface,
  command: ContentControlEditorCommand
): ExecResult {
  const resolved = resolveContentControlTarget(surface, command.target);
  if (!resolved.ok) {
    const target = resolved.target ?? command.target;
    return {
      ok: false,
      code: resolved.code,
      reason: resolved.reason,
      ...(target !== undefined ? { target } : {}),
    };
  }

  // A direct session write below `commit`: queued typing must land first, or a
  // control edit that shrinks the caret paragraph makes the later flush refuse.
  surface.flushPendingInput();
  const before = surface.session.revision();
  const mark = selectionMarkOf(surface.state().selection);
  const op: TreeDocOp =
    command.type === 'setContentControlValue'
      ? { op: 'setContentControlValue', controlId: resolved.controlId, value: command.value }
      : { op: 'removeContentControl', controlId: resolved.controlId };

  const result = surface.session.applyTreeOps([op], mark, mark);
  if (result.rejected) {
    return treeOpRejectionToExecResult(result.reason ?? 'unsupported', command.target);
  }

  surface.layout();
  return { ok: true, changed: surface.session.revision() !== before };
}
