// Atomic Office Math reads and writes for the paginated surface.

import type { TreeApplyResult, TreeDocxSessionView } from '@docx-editor.dev/core/binding';
import type { SemanticPosition, SemanticSelection } from '@docx-editor.dev/core/layout';
import {
  OFFICE_MATH_NAMESPACE_URI,
  equationExpressionToLinearMath,
  findNode,
  parentNodeOf as parentOf,
  projectOmmlEquation,
  segmentsOf,
  type OoxmlNode,
  type OoxmlPart,
  type StoryScope,
  type EquationExpression,
} from '@docx-editor.dev/core/store';

const SUGGESTING_EQUATION_REFUSAL =
  'equation replacement and removal are not supported in suggesting mode';

/** One addressable inline equation and its compact editable projection. */
export interface SurfaceEquation {
  readonly id: string;
  readonly paragraphId: string;
  readonly start: number;
  readonly end: number;
  readonly linear: string;
  readonly fallbackText: string;
  /** True when every source construct belongs to the editable subset. */
  readonly supported: boolean;
}

/** A user click on one painted equation. */
export interface EquationActivation {
  readonly equation: SurfaceEquation;
  readonly rect: {
    readonly left: number;
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
  };
}

function equationsInParagraph(part: OoxmlPart, paragraphId: string): SurfaceEquation[] {
  const paragraph = findNode(part, paragraphId);
  if (!paragraph || paragraph.kind !== 'paragraph') return [];
  const equations: SurfaceEquation[] = [];
  for (const segment of segmentsOf(paragraph)) {
    const node = segment.node;
    if (
      node.kind === 'textValue' ||
      node.kind !== 'generic' ||
      node.namespaceUri !== OFFICE_MATH_NAMESPACE_URI ||
      node.localName !== 'oMath'
    ) {
      continue;
    }
    const projection = projectOmmlEquation(node);
    if (!projection) continue;
    equations.push({
      id: node.id,
      paragraphId,
      start: segment.start,
      end: segment.end,
      linear: equationExpressionToLinearMath(projection.expression),
      fallbackText: projection.fallbackText,
      supported: expressionIsSupported(projection.expression),
    });
  }
  return equations;
}

function expressionIsSupported(expression: EquationExpression): boolean {
  switch (expression.kind) {
    case 'fallback':
      return false;
    case 'text':
      return true;
    case 'row':
      return expression.items.every(expressionIsSupported);
    case 'fraction':
      return (
        expressionIsSupported(expression.numerator) && expressionIsSupported(expression.denominator)
      );
    case 'radical':
      return (
        expressionIsSupported(expression.radicand) &&
        (expression.degree === undefined || expressionIsSupported(expression.degree))
      );
    case 'script':
      return (
        expressionIsSupported(expression.base) &&
        (expression.subscript === undefined || expressionIsSupported(expression.subscript)) &&
        (expression.superscript === undefined || expressionIsSupported(expression.superscript))
      );
    case 'nary':
      return (
        expressionIsSupported(expression.body) &&
        (expression.lowerLimit === undefined || expressionIsSupported(expression.lowerLimit)) &&
        (expression.upperLimit === undefined || expressionIsSupported(expression.upperLimit))
      );
  }
}

/** Boundary-inclusive lookup, matching the hyperlink and field atom popovers. */
export function equationAtPosition(
  equations: readonly SurfaceEquation[],
  position: SemanticPosition
): SurfaceEquation | null {
  return (
    equations.find(
      (equation) =>
        equation.paragraphId === position.paragraphId &&
        position.offset >= equation.start &&
        position.offset <= equation.end
    ) ?? null
  );
}

export interface EquationOpsDeps {
  readonly session: TreeDocxSessionView;
  storyScope(): StoryScope;
  editingMode(): 'edit' | 'suggest' | 'view';
  writeRefusal(op: EquationTreeOp): string | null;
  selection(): SemanticSelection;
  selectionMark(): { paragraphId: string; start: number; end: number } | null;
  commit(
    run: () => TreeApplyResult | boolean,
    selectionAfter?: () => SemanticSelection | null
  ): void;
}

export type EquationAction = 'replace' | 'remove';

/** Engine-owned capability result for equation editing chrome. */
export type EquationCanResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: 'locked' | 'notFound' | 'unsupported';
      readonly reason: string;
    };

type EquationTreeOp =
  | { readonly op: 'setMathEquation'; readonly equationId: string; readonly linear: string }
  | { readonly op: 'removeMathEquation'; readonly equationId: string };

/** Surface equation reads and atomic replace/remove writes. */
export interface EquationOps {
  equationsInCaretParagraph(): SurfaceEquation[];
  equationAtCaret(): SurfaceEquation | null;
  equationById(equationId: string): SurfaceEquation | null;
  /** Whether equation chrome can run an action, with the engine-owned refusal reason. */
  can(equationId: string, action: EquationAction): EquationCanResult;
  applyEquation(equationId: string, linear: string): boolean;
  removeEquation(equationId: string): boolean;
}

export interface EquationInteraction {
  destroy(): void;
}

/** Connect painted equation metadata to atomic selection and host chrome. */
export function createEquationInteraction(deps: {
  readonly pagesLayer: HTMLElement;
  readonly equationById: (equationId: string) => SurfaceEquation | null;
  readonly setSelection: (selection: SemanticSelection) => void;
  readonly onPopover?: (activation: EquationActivation) => void;
}): EquationInteraction {
  const onClick = (event: MouseEvent): void => {
    const view = deps.pagesLayer.ownerDocument.defaultView;
    if (!view || !(event.target instanceof view.Element)) return;
    const target = event.target.closest<HTMLElement>('[data-docx-equation]');
    if (!target || !deps.pagesLayer.contains(target)) return;
    event.preventDefault();
    const equationId = target.dataset.docxEquation;
    if (!equationId) return;
    const equation = deps.equationById(equationId);
    if (!equation) return;
    deps.setSelection({
      anchor: { paragraphId: equation.paragraphId, offset: equation.start },
      head: { paragraphId: equation.paragraphId, offset: equation.end },
    });
    const rect = target.getBoundingClientRect();
    deps.onPopover?.({
      equation,
      rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
    });
  };
  deps.pagesLayer.addEventListener('click', onClick);
  return {
    destroy: () => deps.pagesLayer.removeEventListener('click', onClick),
  };
}

export function createEquationOps(deps: EquationOpsDeps): EquationOps {
  const activePart = (): OoxmlPart | null => deps.session.partFor(deps.storyScope());
  const equationsIn = (paragraphId: string): SurfaceEquation[] => {
    const part = activePart();
    return part ? equationsInParagraph(part, paragraphId) : [];
  };
  const atCaret = (): SurfaceEquation | null => {
    const head = deps.selection().head;
    return equationAtPosition(equationsIn(head.paragraphId), head);
  };
  const byId = (equationId: string): SurfaceEquation | null => {
    const near = equationsIn(deps.selection().head.paragraphId).find(
      (equation) => equation.id === equationId
    );
    if (near) return near;
    for (const part of deps.session.storyParts()) {
      const node = findNode(part, equationId);
      if (
        !node ||
        node.kind !== 'generic' ||
        node.namespaceUri !== OFFICE_MATH_NAMESPACE_URI ||
        node.localName !== 'oMath'
      ) {
        continue;
      }
      let ancestor: OoxmlNode | null = node;
      while (ancestor && ancestor.kind !== 'paragraph') {
        ancestor = parentOf(part, ancestor.id);
      }
      if (!ancestor || ancestor.kind !== 'paragraph') return null;
      return (
        equationsInParagraph(part, ancestor.id).find((equation) => equation.id === equationId) ??
        null
      );
    }
    return null;
  };
  const transact = (equation: SurfaceEquation, op: EquationTreeOp): boolean => {
    let committed = false;
    const after = { paragraphId: equation.paragraphId, offset: equation.start };
    deps.commit(
      () => {
        const result = deps.session.applyTreeOps(
          [op],
          deps.selectionMark(),
          { paragraphId: after.paragraphId, start: after.offset, end: after.offset },
          deps.storyScope()
        );
        committed = result.committed;
        return result;
      },
      () => ({ anchor: after, head: after })
    );
    return committed;
  };
  const capability = (equationId: string, action: EquationAction): EquationCanResult => {
    const equation = byId(equationId);
    if (!equation) return { ok: false, code: 'notFound', reason: 'no equation with that id' };
    // `trackedOps` cannot safely wrap an OMML replacement or removal today. Refuse before
    // `applyTreeOps`, or Suggesting would make the change permanent and unreviewable.
    if (deps.editingMode() === 'suggest') {
      return { ok: false, code: 'unsupported', reason: SUGGESTING_EQUATION_REFUSAL };
    }
    const op: EquationTreeOp =
      action === 'replace'
        ? { op: 'setMathEquation', equationId, linear: equation.linear }
        : { op: 'removeMathEquation', equationId };
    const reason = deps.writeRefusal(op);
    return reason === null ? { ok: true } : { ok: false, code: 'locked', reason };
  };
  const refuse = (result: Exclude<EquationCanResult, { readonly ok: true }>): false => {
    deps.commit(() => ({
      committed: false,
      rejected: true,
      opCount: 0,
      reason: result.reason,
    }));
    return false;
  };

  return {
    equationsInCaretParagraph: () => equationsIn(deps.selection().head.paragraphId),
    equationAtCaret: atCaret,
    equationById: byId,
    can: capability,
    applyEquation(equationId, linear) {
      const equation = byId(equationId);
      if (!equation) return false;
      const allowed = capability(equationId, 'replace');
      if (!allowed.ok) return refuse(allowed);
      if (equation.supported && equation.linear === linear) return true;
      return transact(equation, { op: 'setMathEquation', equationId, linear });
    },
    removeEquation(equationId) {
      const equation = byId(equationId);
      if (!equation) return false;
      const allowed = capability(equationId, 'remove');
      if (!allowed.ok) return refuse(allowed);
      return transact(equation, { op: 'removeMathEquation', equationId });
    },
  };
}
