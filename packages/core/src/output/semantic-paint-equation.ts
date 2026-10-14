// Paint equation geometry without parsing OMML or measuring DOM.

import type {
  EquationGeometry,
  EquationSpanRecord,
  ResolvedRunStyle,
} from '@docx-editor.dev/core/layout';

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
  scale: number,
  parentX = 0,
  parentY = 0,
  ancestors: readonly string[] = [],
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
      host.append(element);
      break;
    }
    case 'row':
      for (const child of node.items)
        paintNode(document, host, child, scale, x, y, classes, applyFace);
      break;
    case 'fraction':
      paintNode(document, host, node.numerator, scale, x, y, classes, applyFace);
      host.append(
        rule(
          document,
          'docx-equation-fraction-bar',
          { ...node.bar, x: x + node.bar.x, y: y + node.bar.y },
          scale
        )
      );
      paintNode(document, host, node.denominator, scale, x, y, classes, applyFace);
      break;
    case 'radical':
      paintNode(document, host, node.sign, scale, x, y, classes, applyFace);
      if (node.degree) paintNode(document, host, node.degree, scale, x, y, classes, applyFace);
      host.append(
        rule(
          document,
          'docx-equation-radical-bar',
          { ...node.bar, x: x + node.bar.x, y: y + node.bar.y },
          scale
        )
      );
      paintNode(document, host, node.radicand, scale, x, y, classes, applyFace);
      break;
    case 'bar':
      paintNode(document, host, node.body, scale, x, y, classes, applyFace);
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
      paintNode(document, host, node.base, scale, x, y, classes, applyFace);
      if (node.subscript)
        paintNode(document, host, node.subscript, scale, x, y, classes, applyFace);
      if (node.superscript)
        paintNode(document, host, node.superscript, scale, x, y, classes, applyFace);
      break;
    case 'nary':
      paintNode(document, host, node.operator, scale, x, y, classes, applyFace);
      if (node.lowerLimit)
        paintNode(document, host, node.lowerLimit, scale, x, y, classes, applyFace);
      if (node.upperLimit)
        paintNode(document, host, node.upperLimit, scale, x, y, classes, applyFace);
      paintNode(document, host, node.body, scale, x, y, classes, applyFace);
      break;
  }
}

/** Mount one paint-ready equation into its already styled atomic span. */
export function mountEquationGeometry(
  document: Document,
  host: HTMLElement,
  equation: EquationSpanRecord,
  scale: number,
  applyFace?: (element: HTMLElement, style: ResolvedRunStyle) => void
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
  paintNode(document, fragment, geometry, scale, 0, 0, [], applyFace);
  host.append(fragment);
}
