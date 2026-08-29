import { parseInlineStyle, tagOf } from './clipboard-html-styles.ts';

function isPageBreak(element: Element): boolean {
  if (tagOf(element) !== 'br') return false;
  const style = parseInlineStyle(element);
  return (
    style.get('page-break-before')?.trim().toLowerCase() === 'always' ||
    style.get('break-before')?.trim().toLowerCase() === 'page'
  );
}

/** Match Word's top-level page-break `br`, with its optional formatting `span`. */
export function isWordPageBreakBlock(element: Element): boolean {
  if (isPageBreak(element)) return true;
  if (tagOf(element) !== 'span') return false;
  if (element.childNodes.length > 8) return false;
  let found = false;
  for (let index = 0; index < element.childNodes.length; index += 1) {
    const child = element.childNodes[index]!;
    if (child.nodeType === 3 && (child.nodeValue ?? '').trim().length === 0) continue;
    if (child.nodeType !== 1 || found || !isPageBreak(child as Element)) return false;
    found = true;
  }
  return found;
}

/** Match Word's redundant empty paragraph directly after an exported page break. */
export function isWordPageBreakSpacer(element: Element): boolean {
  if (tagOf(element) !== 'p' || element.children.length !== 1) return false;
  const officeParagraph = element.children[0]!;
  if (tagOf(officeParagraph) !== 'o:p' || officeParagraph.childNodes.length > 3) return false;
  let text = '';
  for (let index = 0; index < officeParagraph.childNodes.length; index += 1) {
    const child = officeParagraph.childNodes[index]!;
    if (child.nodeType !== 3) return false;
    text += child.nodeValue ?? '';
  }
  return text.includes('\u00a0') && text.replace(/[\s\u00a0]/g, '').length === 0;
}

export const IGNORED_TAGS: ReadonlySet<string> = new Set(
  (
    'script style head template iframe object embed noscript svg math ' +
    'meta link title base select textarea hr w:sdtpr'
  ).split(' ')
);

export const PARAGRAPH_TAGS: ReadonlySet<string> = new Set(
  'p div h1 h2 h3 h4 h5 h6 li blockquote pre'.split(' ')
);

export const CONTAINER_TAGS: ReadonlySet<string> = new Set(
  'thead tbody tfoot tr section article main header footer aside nav figure form body html'.split(
    ' '
  )
);

const BLOCK_CHILD_TAGS: ReadonlySet<string> = new Set([
  ...PARAGRAPH_TAGS,
  ...CONTAINER_TAGS,
  'table',
  'ol',
  'ul',
  'w:sdt',
]);

/** True when a `div` is a wrapper over block flow (Word's `WordSection1`), not a leaf. */
export function hasBlockChild(element: Element): boolean {
  for (let index = 0; index < element.children.length; index += 1) {
    if (BLOCK_CHILD_TAGS.has(tagOf(element.children[index]!))) return true;
  }
  return false;
}

const SDT_BLOCK_TAGS = new Set([
  'p',
  'div',
  'table',
  'ol',
  'ul',
  'section',
  'article',
  'main',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

/** Find bounded block flow inside an SDT while leaving inline checkbox SDTs inline. */
export function wordBlockSdtNodes(element: Element): readonly Node[] | null {
  if (tagOf(element) !== 'w:sdt') return null;
  const queue: Element[] = [element];
  let inspected = 0;
  for (let at = 0; at < queue.length && inspected < 64; at += 1) {
    const parent = queue[at]!;
    if (parent.childNodes.length > 64) return null;
    const nodes: Node[] = [];
    let hasBlock = false;
    for (let index = 0; index < parent.childNodes.length; index += 1) {
      const child = parent.childNodes[index]!;
      nodes.push(child);
      if (child.nodeType === 1 && SDT_BLOCK_TAGS.has(tagOf(child as Element))) hasBlock = true;
    }
    if (hasBlock) return nodes;
    for (let index = 0; index < parent.children.length && inspected < 64; index += 1) {
      const child = parent.children[index]!;
      inspected += 1;
      const tag = tagOf(child);
      if (tag !== 'w:sdtpr') queue.push(child);
    }
  }
  return null;
}
