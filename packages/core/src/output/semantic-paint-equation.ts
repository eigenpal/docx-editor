// Paint equation geometry without parsing OMML or measuring DOM.

import { markUnsupportedElement } from './unsupported-elements.ts';
import type { EquationGeometry, EquationSpanRecord } from '@docx-editor.dev/core/layout';

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
  equation: EquationSpanRecord,
  scale: number,
  parentX = 0,
  parentY = 0,
  ancestors: readonly string[] = [],
  path = '0'
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
            kind: 'equation',
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
        paintNode(document, host, child, equation, scale, x, y, classes, `${path}.${index}`);
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
        `${path}.numerator`
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
        `${path}.denominator`
      );
      break;
    case 'radical':
      paintNode(document, host, node.sign, equation, scale, x, y, classes, `${path}.sign`);
      if (node.degree)
        paintNode(document, host, node.degree, equation, scale, x, y, classes, `${path}.degree`);
      host.append(
        rule(
          document,
          'docx-equation-radical-bar',
          { ...node.bar, x: x + node.bar.x, y: y + node.bar.y },
          scale
        )
      );
      paintNode(document, host, node.radicand, equation, scale, x, y, classes, `${path}.radicand`);
      break;
    case 'script':
      paintNode(document, host, node.base, equation, scale, x, y, classes, `${path}.base`);
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
          `${path}.subscript`
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
          `${path}.superscript`
        );
      break;
    case 'nary':
      paintNode(document, host, node.operator, equation, scale, x, y, classes, `${path}.operator`);
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
          `${path}.lowerLimit`
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
          `${path}.upperLimit`
        );
      paintNode(document, host, node.body, equation, scale, x, y, classes, `${path}.body`);
      break;
  }
}

/** Mount one paint-ready equation into its already styled atomic span. */
export function mountEquationGeometry(
  document: Document,
  host: HTMLElement,
  equation: EquationSpanRecord,
  scale: number
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
  paintNode(document, fragment, geometry, equation, scale);
  host.append(fragment);
}
