/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * A paragraph's inline content as one sequence (openspec `paragraph-text-collaboration`).
 *
 * Every character of a text element is one item, and every other inline element is one
 * embedded node. Each item carries the run it belongs to, that run's properties, the text
 * element it sits in, and the chain of wrappers around it, outer to inner. The sequence is
 * what one shared text per paragraph stores; this module only converts between it and the
 * canonical tree, so the round trip can be proven on the corpus before any shared state.
 */
import { WML_NAMESPACE_URI, type OoxmlElement, type OoxmlNode } from '@docx-editor.dev/core/store';
import { elementsOf, expectElement, textNode, withChildren } from './node-shapes.ts';

/** An element without its content: what a run, text element, or wrapper record keeps. */
export type ElementShell = OoxmlElement;

export interface LinearAttributes {
  /** The run around the item, with no children, or null outside any run. */
  readonly run: ElementShell | null;
  /** The run's `w:rPr` without children, and its property elements in their order. */
  readonly runProperties: ElementShell | null;
  readonly properties: readonly OoxmlElement[];
  /** The text element around a character, with no children, and its text value's ID. */
  readonly text: ElementShell | null;
  readonly textValueId: string | null;
  /** Wrappers around the item, outer to inner; each keeps only its fixed children. */
  readonly wrap: readonly ElementShell[];
  /**
   * What makes two items one run and one wrapper, when IDs alone do not: shared text can
   * give one run's characters different properties, or one wrapper's characters different
   * attributes. Absent, the IDs decide.
   */
  readonly runSignature?: string;
  readonly wrapSignatures?: readonly string[];
}

export type LinearItem =
  | { readonly kind: 'char'; readonly value: string; readonly attributes: LinearAttributes }
  | { readonly kind: 'embed'; readonly node: OoxmlNode; readonly attributes: LinearAttributes }
  /** Keeps an element that holds no content: an empty run, text element, or wrapper. */
  | { readonly kind: 'anchor'; readonly attributes: LinearAttributes };

export interface LinearParagraph {
  /** The paragraph with only its block-level children, such as `w:pPr`. */
  readonly shell: ElementShell;
  readonly items: readonly LinearItem[];
}

const TEXT_ELEMENTS = new Set(['t', 'delText', 'instrText', 'delInstrText']);
const WRAPPERS = new Set([
  'hyperlink',
  'ins',
  'del',
  'moveFrom',
  'moveTo',
  'sdt',
  'sdtContent',
  'fldSimple',
  'smartTag',
  'customXml',
  'dir',
  'bdo',
]);
/** Wrapper children that describe the wrapper rather than hold its content. */
const FIXED_WRAPPER_CHILDREN = new Set([
  'sdtPr',
  'sdtEndPr',
  'smartTagPr',
  'customXmlPr',
  'fldData',
]);

function isWml(node: OoxmlNode, names: ReadonlySet<string>): node is OoxmlElement {
  return (
    node.kind !== 'textValue' &&
    node.namespaceUri === WML_NAMESPACE_URI &&
    names.has(node.localName)
  );
}

function shellOf(element: OoxmlElement, children: readonly OoxmlNode[] = []): ElementShell {
  return withChildren(element, children);
}

function isTextElement(node: OoxmlNode): node is OoxmlElement {
  return isWml(node, TEXT_ELEMENTS) && node.children.every((child) => child.kind === 'textValue');
}

/** The paragraph's inline content as one sequence. */
export function linearizeParagraph(paragraph: OoxmlElement): LinearParagraph {
  const items: LinearItem[] = [];
  const block: OoxmlNode[] = [];
  const none: LinearAttributes = {
    run: null,
    runProperties: null,
    properties: [],
    text: null,
    textValueId: null,
    wrap: [],
  };
  const visitRun = (run: OoxmlElement, wrap: readonly ElementShell[]): void => {
    const rPr = run.children.find((child) => child.kind === 'runProperties') as
      | OoxmlElement
      | undefined;
    const base: LinearAttributes = {
      ...none,
      run: shellOf(run),
      runProperties: rPr ? shellOf(rPr) : null,
      properties: rPr ? elementsOf(rPr.children) : [],
      wrap,
    };
    let content = 0;
    for (const child of run.children) {
      if (child === rPr) continue;
      content += 1;
      if (isTextElement(child)) {
        const value = child.children.map((c) => (c.kind === 'textValue' ? c.value : '')).join('');
        const attributes: LinearAttributes = {
          ...base,
          text: shellOf(child),
          textValueId: child.children[0]?.id ?? null,
        };
        if (value.length === 0) items.push({ kind: 'anchor', attributes });
        // One item per UTF-16 code unit: shared text counts code units, so its offsets and
        // these items stay the same numbers. A surrogate pair is two items with one attribute set.
        for (let at = 0; at < value.length; at += 1) {
          items.push({ kind: 'char', value: value[at]!, attributes });
        }
      } else {
        items.push({ kind: 'embed', node: child, attributes: base });
      }
    }
    if (content === 0) items.push({ kind: 'anchor', attributes: base });
  };
  const visit = (nodes: readonly OoxmlNode[], wrap: readonly ElementShell[]): void => {
    for (const node of nodes) {
      if (node.kind === 'run') {
        visitRun(node, wrap);
      } else if (isWml(node, WRAPPERS)) {
        const fixed = node.children.filter((child) => isWml(child, FIXED_WRAPPER_CHILDREN));
        const inner = [...wrap, shellOf(node, fixed)];
        const content = node.children.filter((child) => !fixed.includes(child));
        if (content.length === 0)
          items.push({ kind: 'anchor', attributes: { ...none, wrap: inner } });
        visit(content, inner);
      } else {
        items.push({ kind: 'embed', node, attributes: { ...none, wrap } });
      }
    }
  };
  const inline: OoxmlNode[] = [];
  for (const child of paragraph.children) {
    if (child.kind === 'paragraphProperties') block.push(child);
    else inline.push(child);
  }
  visit(inline, []);
  return { shell: shellOf(paragraph, block), items };
}

interface Builder {
  readonly shell: ElementShell;
  readonly children: (OoxmlNode | Builder)[];
  /** A run or text element still accepting content of the same identity. */
  openRun: { key: string; builder: Builder } | null;
  openText: { key: string; builder: Builder; valueId: string; value: string } | null;
  signature?: string;
}

function builder(shell: ElementShell): Builder {
  return { shell, children: [...shell.children], openRun: null, openText: null };
}

function runKey(attributes: LinearAttributes): string {
  if (attributes.runSignature !== undefined) return attributes.runSignature;
  return [
    attributes.run!.id,
    attributes.runProperties?.id ?? '',
    ...attributes.properties.map((property) => property.id),
  ].join('\u0001');
}

/** The paragraph a sequence describes. */
export function materializeParagraph(linear: LinearParagraph): OoxmlElement {
  const root = builder(linear.shell);
  const stack: Builder[] = [root];
  const closeText = (run: Builder): void => {
    const open = run.openText;
    if (!open) return;
    if (open.value.length > 0) {
      open.builder.children.push(textNode(open.valueId, open.value));
    }
    run.openText = null;
  };
  const closeRun = (frame: Builder): void => {
    if (frame.openRun) closeText(frame.openRun.builder);
    frame.openRun = null;
  };
  for (const item of linear.items) {
    const { wrap } = item.attributes;
    const signatures = item.attributes.wrapSignatures;
    const sameWrapper = (frame: Builder, at: number): boolean =>
      signatures ? frame.signature === signatures[at] : frame.shell.id === wrap[at]!.id;
    let depth = 1;
    while (
      depth < stack.length &&
      depth - 1 < wrap.length &&
      sameWrapper(stack[depth]!, depth - 1)
    ) {
      depth += 1;
    }
    while (stack.length > depth) {
      closeRun(stack[stack.length - 1]!);
      stack.pop();
    }
    for (let at = depth - 1; at < wrap.length; at += 1) {
      const parent = stack[stack.length - 1]!;
      closeRun(parent);
      const opened = builder(wrap[at]!);
      opened.signature = signatures?.[at];
      parent.children.push(opened);
      stack.push(opened);
    }
    const frame = stack[stack.length - 1]!;
    if (!item.attributes.run) {
      closeRun(frame);
      if (item.kind === 'embed') frame.children.push(item.node);
      continue;
    }
    const key = runKey(item.attributes);
    if (frame.openRun?.key !== key) {
      closeRun(frame);
      const run = builder(item.attributes.run);
      if (item.attributes.runProperties) {
        run.children.push(shellOf(item.attributes.runProperties, item.attributes.properties));
      }
      frame.children.push(run);
      frame.openRun = { key, builder: run };
    }
    const run = frame.openRun!.builder;
    if (item.kind === 'embed') {
      closeText(run);
      run.children.push(item.node);
      continue;
    }
    if (!item.attributes.text) continue;
    if (run.openText?.key !== item.attributes.text.id) {
      closeText(run);
      const text = builder(item.attributes.text);
      run.children.push(text);
      run.openText = {
        key: item.attributes.text.id,
        builder: text,
        valueId: item.attributes.textValueId ?? `${item.attributes.text.id}/value`,
        value: '',
      };
    }
    if (item.kind === 'char') run.openText!.value += item.value;
  }
  while (stack.length > 0) closeRun(stack.pop()!);
  const finish = (node: OoxmlNode | Builder): OoxmlNode =>
    'shell' in node
      ? Object.freeze(withChildren(node.shell, Object.freeze(node.children.map(finish))))
      : node;
  return expectElement(finish(root));
}
