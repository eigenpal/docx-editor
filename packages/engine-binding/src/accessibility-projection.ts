// PM-free accessibility observation and painted-page assistive policy (interactive-paginated 4.6).

import { bodyStoryId, isTopLevelEditable, type Block, type PackageModel, type ParagraphRecord, type SdtRecord } from '@docx-editor.dev/engine-core';
import type { ViewScope } from '@docx-editor.dev/core-contract/editor';
import type {
  AccessibilityEntry,
  AccessibilityEntryRole,
  AccessibilityNamePolicy,
  AccessibilityObservation,
  AccessibilityProjectionOwner,
  AccessibilitySelectionObservation,
  FocusObservation,
  InteractionFrameId,
  SemanticTarget,
} from '@docx-editor.dev/core-contract/interaction';
import { NodeSelection as NodeSelectionCtor } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import type { DocxEditorSession } from './session.ts';
import { utf16OffsetToGrapheme } from './grapheme.ts';
import { captureSelectionRange, type SelectionRangeAnchors } from './selection.ts';
import { paragraphOwnership } from './semantic-ownership.ts';

export const PAINTED_PAGES_ASSISTIVE_MARKER = 'data-docx-painted-pages-assistive';
export const ATOM_EMBED_SELECTOR = '.docx-block-embed[data-kind][data-sem-id]';

export interface ObserveAccessibilityInput {
  readonly frameId: InteractionFrameId;
  readonly scope: ViewScope;
  readonly modelRevision: number;
  readonly editable: boolean;
  readonly name: AccessibilityNamePolicy;
  readonly focus: FocusObservation;
  readonly selectionRange: SelectionRangeAnchors | null;
  readonly atomicObjectId: string | null;
  readonly model: PackageModel;
  readonly owner: AccessibilityProjectionOwner;
  readonly paintedPagesAssistiveRole: 'presentation' | null;
}

export interface AccessibilityObservationRequest {
  readonly frameId: InteractionFrameId;
  readonly scope: ViewScope;
}

function flattenSdt(blocks: readonly Block[]): Block[] {
  const out: Block[] = [];
  for (const b of blocks) {
    if (b.kind === 'sdt') out.push(...flattenSdt((b as SdtRecord).blocks));
    else out.push(b);
  }
  return out;
}

function paragraphText(p: ParagraphRecord): string {
  return p.runs.map((r) => r.text).join('');
}

function entryRoleForBlock(block: Block, editableParagraph: boolean): AccessibilityEntryRole {
  if (block.kind === 'paragraph') return editableParagraph ? 'editableParagraph' : 'unsupportedStructure';
  return 'readOnlyAtom';
}

/** Build canonical ordered accessibility entries for the body story. */
export function buildAccessibilityEntries(model: PackageModel, scope: ViewScope): readonly AccessibilityEntry[] {
  if (scope.kind !== 'body') return [];
  const storyId = bodyStoryId(model);
  const story = model.stories.get(storyId);
  if (!story) return [];

  const entries: AccessibilityEntry[] = [];
  let orderIndex = 0;
  for (const block of flattenSdt(story.blocks)) {
    const editableParagraph = block.kind === 'paragraph' && isTopLevelEditable('paragraph');
    const role = entryRoleForBlock(block, editableParagraph);
    if (block.kind === 'paragraph') {
      entries.push({
        orderIndex,
        identity: { storyId: story.id, blockId: block.id },
        role,
        readOnly: !editableParagraph,
        text: paragraphText(block as ParagraphRecord),
      });
    } else {
      entries.push({
        orderIndex,
        identity: { storyId: story.id, blockId: block.id },
        role,
        readOnly: true,
        text: '',
        atomKind: block.kind,
      });
    }
    orderIndex += 1;
  }
  return entries;
}

function anchorToTarget(
  anchor: SelectionRangeAnchors['anchor'],
  model: PackageModel,
  scope: ViewScope,
  storyId: string,
): SemanticTarget | null {
  if (!anchor.paragraphId) return null;
  const owned = paragraphOwnership(model, anchor.paragraphId, storyId);
  if (!owned) return null;
  const text = paragraphText(owned.paragraph);
  return {
    kind: 'text',
    scope,
    identity: { storyId, blockId: anchor.paragraphId },
    graphemeOffset: utf16OffsetToGrapheme(text, anchor.offset),
    affinity: anchor.affinity === 'before' ? 'upstream' : 'downstream',
  };
}

function buildSelectionObservation(
  input: ObserveAccessibilityInput,
  storyId: string,
): AccessibilitySelectionObservation | null {
  if (input.atomicObjectId) {
    const target: SemanticTarget = { kind: 'atomic', scope: input.scope, objectId: input.atomicObjectId };
    return { collapsed: true, anchor: target, head: target };
  }
  if (!input.selectionRange) return null;
  const anchor = anchorToTarget(input.selectionRange.anchor, input.model, input.scope, storyId);
  const head = anchorToTarget(input.selectionRange.head, input.model, input.scope, storyId);
  if (!anchor || !head) return null;
  const collapsed =
    anchor.kind === 'text' &&
    head.kind === 'text' &&
    anchor.identity.blockId === head.identity.blockId &&
    anchor.graphemeOffset === head.graphemeOffset;
  return { collapsed, anchor, head };
}

function freezeTarget(target: SemanticTarget): SemanticTarget {
  if (target.kind === 'atomic') return Object.freeze({ ...target });
  return Object.freeze({ ...target, identity: Object.freeze({ ...target.identity }) });
}

function freezeSelection(selection: AccessibilitySelectionObservation | null): AccessibilitySelectionObservation | null {
  if (!selection) return null;
  return Object.freeze({
    collapsed: selection.collapsed,
    anchor: freezeTarget(selection.anchor),
    head: freezeTarget(selection.head),
  });
}

/** Return a deeply frozen PM-free accessibility observation for conformance. */
export function freezeAccessibilityObservation(obs: AccessibilityObservation): AccessibilityObservation {
  const entries = Object.freeze(
    obs.entries.map((entry) =>
      Object.freeze({
        ...entry,
        identity: Object.freeze({ ...entry.identity }),
      }),
    ),
  );
  return Object.freeze({
    ...obs,
    name: Object.freeze({ ...obs.name }),
    focus: Object.freeze({ ...obs.focus }),
    entries,
    selection: freezeSelection(obs.selection),
  });
}

/** Project an immutable PM-free accessibility observation from canonical state. */
export function observeAccessibility(input: ObserveAccessibilityInput): AccessibilityObservation {
  const storyId = bodyStoryId(input.model);
  return freezeAccessibilityObservation({
    owner: input.owner,
    scope: input.scope,
    frameId: input.frameId,
    modelRevision: input.modelRevision,
    editable: input.editable,
    name: input.name,
    entries: buildAccessibilityEntries(input.model, input.scope),
    focus: input.focus,
    selection: buildSelectionObservation(input, storyId),
    paintedPagesAssistiveRole: input.paintedPagesAssistiveRole,
  });
}

export function resolveAccessibilityNamePolicy(accessibleName?: string): AccessibilityNamePolicy {
  if (accessibleName && accessibleName.length > 0) return { kind: 'provided', value: accessibleName };
  return { kind: 'absent' };
}

/** Apply or clear the localized accessible name on the semantic projection mount. */
export function applyAccessibleNamePolicy(mount: HTMLElement, policy: AccessibilityNamePolicy): void {
  if (policy.kind === 'provided') mount.setAttribute('aria-label', policy.value);
  else mount.removeAttribute('aria-label');
}

/** Apply localized atom labels and read-only semantics after PM projection updates. */
export function applyAtomAccessibilityLabels(
  root: HTMLElement,
  labels?: Readonly<Record<string, string>>,
): void {
  for (const node of root.querySelectorAll(ATOM_EMBED_SELECTOR)) {
    if (!(node instanceof HTMLElement)) continue;
    node.setAttribute('aria-readonly', 'true');
    node.setAttribute('tabindex', '-1');
    node.textContent = '';
    const kind = node.getAttribute('data-kind') ?? '';
    const label = labels?.[kind];
    if (label) node.setAttribute('aria-label', label);
    else node.removeAttribute('aria-label');
  }
}

/** Reapply mount and atom accessibility DOM after projection reconciliation. */
export function reapplyAccessibilityProjectionDom(
  mount: HTMLElement,
  name: AccessibilityNamePolicy,
  atomLabels?: Readonly<Record<string, string>>,
): void {
  applyAccessibleNamePolicy(mount, name);
  applyAtomAccessibilityLabels(mount, atomLabels);
}

/** Mark engine-painted page output presentation-only while PM owns assistive access. */
export function markPaintedPagesPresentationOnly(container: HTMLElement): void {
  container.setAttribute(PAINTED_PAGES_ASSISTIVE_MARKER, 'presentation-only');
  container.setAttribute('role', 'presentation');
  container.setAttribute('aria-hidden', 'true');
  for (const child of container.children) {
    if (child instanceof HTMLElement) {
      child.setAttribute('role', 'presentation');
      child.setAttribute('aria-hidden', 'true');
    }
  }
}

/** Restore shared host DOM after editor destroy or assistive-policy teardown. */
export function clearPaintedPagesPresentationOnly(container: HTMLElement): void {
  container.removeAttribute(PAINTED_PAGES_ASSISTIVE_MARKER);
  container.removeAttribute('role');
  container.removeAttribute('aria-hidden');
  for (const child of container.children) {
    if (child instanceof HTMLElement) {
      child.removeAttribute('role');
      child.removeAttribute('aria-hidden');
    }
  }
}

export interface CaptureAccessibilityStateInput {
  readonly view: EditorView;
  readonly scope: ViewScope;
  readonly editable: boolean;
  readonly name: AccessibilityNamePolicy;
  readonly frameId: InteractionFrameId;
  readonly owner: AccessibilityProjectionOwner;
  readonly paintedPagesAssistiveRole: 'presentation' | null;
}

/** Capture live focus/selection state for accessibility observation (binding-internal). */
export function captureAccessibilityState(input: CaptureAccessibilityStateInput): Omit<
  ObserveAccessibilityInput,
  'model' | 'modelRevision'
> {
  const { view, scope, editable, name, frameId, owner, paintedPagesAssistiveRole } = input;
  const doc = view.dom.ownerDocument;
  const focused = !view.isDestroyed && (view.hasFocus() || doc?.activeElement === view.dom);
  const selection = view.state.selection;
  const atomicObjectId =
    selection instanceof NodeSelectionCtor && selection.node.type.name === 'blockEmbed' && selection.node.attrs.semId
      ? String(selection.node.attrs.semId)
      : null;
  return {
    frameId,
    scope,
    editable,
    name,
    owner,
    paintedPagesAssistiveRole,
    focus: { scope: focused ? scope : null, focused: !!focused },
    selectionRange: atomicObjectId ? null : captureSelectionRange(view.state),
    atomicObjectId,
  };
}

export function observeAccessibilityFromSession(
  session: DocxEditorSession,
  request: AccessibilityObservationRequest,
  state: Omit<ObserveAccessibilityInput, 'model' | 'modelRevision' | 'frameId' | 'scope'>,
): AccessibilityObservation {
  return observeAccessibility({
    ...state,
    frameId: request.frameId,
    scope: request.scope,
    model: session.currentModel(),
    modelRevision: session.revision(),
  });
}