import type { OoxmlElement } from '@docx-editor.dev/core/store';
// Paint equation geometry without parsing OMML or measuring DOM.

import { markUnsupportedElement } from './unsupported-elements.ts';
import type {
  EquationGeometry,
  EquationSpanRecord,
  ResolvedRunStyle,
  StyleSpanRecord,
} from '@docx-editor.dev/core/layout';
import { applyRevisionPresentation } from './semantic-paint-revisions.ts';
import { revisionMarkupStyle } from '../contracts/revision-markup.ts';
import type { PaintContext } from './semantic-paint.ts';

function place(
  element: HTMLElement,
  geometry: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  scale: number
): void {
  element.style.position = 'absolute';
  element.style.left = `${geometry.x * scale}px`;
  element.style.top = `${geometry.y * scale}px`;
  element.style.width = `${geometry.width * scale}px`;
  element.style.height = `${geometry.height * scale}px`;
}

function rule(
  document: Document,
  className: string,
  geometry: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  },
  scale: number
): HTMLElement {
  const element = document.createElement('span');
  element.className = className;
  element.setAttribute('aria-hidden', 'true');
  element.style.position = 'absolute';
  element.style.display = 'block';
  element.style.left = `${geometry.x * scale}px`;
  element.style.top = `${geometry.y * scale}px`;
  element.style.width = `${geometry.width * scale}px`;
  element.style.height = `${geometry.height * scale}px`;
  element.style.backgroundColor = 'currentColor';
  element.style.pointerEvents = 'none';
  return element;
}

function paintNode(
  document: Document,
  host: DocumentFragment,
  node: EquationGeometry,
  equation: EquationSpanRecord & {
    unsupportedSource?: OoxmlElement | null;
    ownerPartName?: string;
  },
  scale: number,
  parentX = 0,
  parentY = 0,
  ancestors: readonly string[] = [],
  path = '0',
  applyFace?: (element: HTMLElement, style: ResolvedRunStyle) => void
): void {
  const x = parentX + node.box.x;
  const y = parentY + node.box.y;
  const classes = [...ancestors, node.kind];
  switch (node.kind) {
    case 'text':
    case 'fallback': {
      const element = document.createElement('span');
      element.className = [
        'docx-equation-node',
        ...classes.map((kind) => `docx-equation-${kind}`),
      ].join(' ');
      place(element, { x, y, width: node.box.width, height: node.box.height }, scale);
      element.textContent = node.text;
      element.style.display = 'block';
      if (node.runStyle && applyFace) {
        element.style.fontWeight = node.runStyle.bold ? 'bold' : 'normal';
        element.style.fontStyle = node.runStyle.italic ? 'italic' : 'normal';
        applyFace(element, node.runStyle);
      }
      element.style.fontSize = `${node.fontSizePt * scale}px`;
      element.style.lineHeight = `${node.box.height * scale}px`;
      element.style.whiteSpace = 'pre';
      if (node.kind === 'fallback') {
        const fallback = document.createElement('span');
        fallback.textContent = node.text;
        element.textContent = '';
        element.append(fallback);
        markUnsupportedElement(
          element,
          fallback,
          {
            ownerPartName: equation.ownerPartName ?? '',
            namespaceUri:
              equation.unsupportedSource?.namespaceUri ??
              'http://schemas.openxmlformats.org/officeDocument/2006/math',
            localName: equation.unsupportedSource?.localName ?? 'oMath',
            source: equation.unsupportedSource ?? null,
            placement: 'inline',
            bounds: { x, y, width: node.box.width, height: node.box.height },
            nodeId: equation.sourceNodeId,
            label: node.text,
            equation,
          },
          undefined,
          path
        );
      }
      host.append(element);
      break;
    }
    case 'row':
      for (const [index, child] of node.items.entries())
        paintNode(
          document,
          host,
          child,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.${index}`,
          applyFace
        );
      break;
    case 'fraction':
      paintNode(
        document,
        host,
        node.numerator,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.numerator`,
        applyFace
      );
      host.append(
        rule(
          document,
          'docx-equation-fraction-bar',
          { ...node.bar, x: x + node.bar.x, y: y + node.bar.y },
          scale
        )
      );
      paintNode(
        document,
        host,
        node.denominator,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.denominator`,
        applyFace
      );
      break;
    case 'radical':
      paintNode(
        document,
        host,
        node.sign,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.sign`,
        applyFace
      );
      if (node.degree)
        paintNode(
          document,
          host,
          node.degree,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.degree`,
          applyFace
        );
      host.append(
        rule(
          document,
          'docx-equation-radical-bar',
          { ...node.bar, x: x + node.bar.x, y: y + node.bar.y },
          scale
        )
      );
      paintNode(
        document,
        host,
        node.radicand,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.radicand`,
        applyFace
      );
      break;
    case 'bar':
      paintNode(
        document,
        host,
        node.body,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.body`,
        applyFace
      );
      host.append(
        rule(
          document,
          'docx-equation-bar',
          { ...node.bar, x: x + node.bar.x, y: y + node.bar.y },
          scale
        )
      );
      break;
    case 'script':
      paintNode(
        document,
        host,
        node.base,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.base`,
        applyFace
      );
      if (node.subscript)
        paintNode(
          document,
          host,
          node.subscript,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.subscript`,
          applyFace
        );
      if (node.superscript)
        paintNode(
          document,
          host,
          node.superscript,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.superscript`,
          applyFace
        );
      break;
    case 'nary':
      paintNode(
        document,
        host,
        node.operator,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.operator`,
        applyFace
      );
      if (node.lowerLimit)
        paintNode(
          document,
          host,
          node.lowerLimit,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.lowerLimit`,
          applyFace
        );
      if (node.upperLimit)
        paintNode(
          document,
          host,
          node.upperLimit,
          equation,
          scale,
          x,
          y,
          classes,
          `${path}.upperLimit`,
          applyFace
        );
      paintNode(
        document,
        host,
        node.body,
        equation,
        scale,
        x,
        y,
        classes,
        `${path}.body`,
        applyFace
      );
      break;
  }
}

/** Mount one paint-ready equation into its already styled atomic span. */
export function mountEquationGeometry(
  document: Document,
  host: HTMLElement,
  equation: EquationSpanRecord & {
    unsupportedSource?: OoxmlElement | null;
    ownerPartName?: string;
  },
  scale: number,
  applyFace?: (element: HTMLElement, style: ResolvedRunStyle) => void,
  source?: OoxmlElement | null,
  ownerPartName?: string
): void {
  const geometry = equation.geometry;
  host.className = 'layout-run docx-equation';
  host.dataset.docxEquation = equation.sourceNodeId;
  host.setAttribute('contenteditable', 'false');
  host.setAttribute('role', 'math');
  if (equation.fallbackText) host.setAttribute('aria-label', equation.fallbackText);
  host.style.position = 'relative';
  host.style.display = 'inline-block';
  host.style.width = `${geometry.box.width * scale}px`;
  host.style.height = `${geometry.box.height * scale}px`;
  host.style.lineHeight = '0';
  host.style.pointerEvents = 'auto';
  host.style.userSelect = 'none';
  // An inline-block exposes its bottom edge as its CSS baseline. Move the box down by its
  // published descent so the equation's internal baseline meets the surrounding text.
  host.style.verticalAlign = `${-(geometry.box.height - geometry.baseline) * scale}px`;
  const fragment = document.createDocumentFragment();
  paintNode(
    document,
    fragment,
    geometry,
    { ...equation, unsupportedSource: source ?? null, ...(ownerPartName ? { ownerPartName } : {}) },
    scale,
    0,
    0,
    [],
    '0',
    applyFace
  );
  host.append(fragment);
}

/** Resolve canonical metadata at the painter boundary, keeping layout records DOM-free. */
export function mountEquationForSpan(
  document: Document,
  host: HTMLElement,
  equation: EquationSpanRecord,
  context: {
    readonly scale: number;
    readonly unsupportedSource?: (nodeId: string, ownerPartName?: string) => OoxmlElement | null;
    readonly unsupportedOwnerPartName?: (nodeId: string) => string;
  },
  applyFace?: (element: HTMLElement, style: ResolvedRunStyle) => void
): void {
  mountEquationGeometry(
    document,
    host,
    equation,
    context.scale,
    applyFace,
    context.unsupportedSource?.(equation.sourceNodeId),
    context.unsupportedOwnerPartName?.(equation.sourceNodeId)
  );
}

/**
 * The revision mark of an equation: its presentation, plus an explicit bar. The glyphs are
 * absolutely positioned, and CSS never carries a text decoration to out-of-flow children, so
 * a struck or underlined equation would otherwise show no line at all, and under a host's
 * revision markup a deleted equation would look the same as an inserted one.
 */
export function applyEquationRevision(
  document: Document,
  host: HTMLElement,
  span: StyleSpanRecord,
  ctx: PaintContext
): void {
  applyRevisionPresentation(host, span, ctx);
  const kind = host.dataset.revisionKind;
  if (kind !== 'delete' && kind !== 'moveFrom' && kind !== 'insert' && kind !== 'moveTo') return;
  const box = span.equation?.geometry.box;
  if (!box) return;
  // A host's revision markup decides the mark, as it does for the text beside the equation.
  const mark = ctx.revisionMarkup
    ? revisionMarkupStyle(ctx.revisionMarkup, kind).mark
    : kind === 'delete' || kind === 'moveFrom'
      ? 'strikethrough'
      : 'underline';
  const strike = mark === 'strikethrough' || mark === 'doubleStrikethrough';
  if (!strike && mark !== 'underline' && mark !== 'doubleUnderline') return;
  const doubled = mark === 'doubleStrikethrough' || mark === 'doubleUnderline';
  if (strike) {
    // Each glyph run is struck on its own, as struck text is. One bar across the box sat on
    // the math axis, where a fraction bar already is, so a deleted fraction looked merely
    // recoloured; striking the runs crosses the numerator and the denominator instead.
    for (const glyph of host.querySelectorAll<HTMLElement>(
      '.docx-equation-text, .docx-equation-fallback'
    )) {
      glyph.classList.add('docx-equation-revision-strike');
      glyph.style.textDecorationLine = 'line-through';
      glyph.style.textDecorationStyle = doubled ? 'double' : 'solid';
      glyph.style.textDecorationColor = 'currentColor';
    }
    return;
  }
  const thickness = 0.75;
  const ys = doubled
    ? [box.height - 3 * thickness, box.height - thickness]
    : [box.height - thickness];
  for (const y of ys) {
    host.append(
      rule(
        document,
        'docx-equation-revision-underline',
        { x: 0, y, width: box.width, height: thickness },
        ctx.scale
      )
    );
  }
}
