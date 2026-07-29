// Canonical tree <-> ProseMirror binding (tasks 6.1, 6.2, 6.3).
//
// Forward: project one revision of the tree into a ProseMirror doc.
// Reverse: map an edited doc back into typed tree ops, or REFUSE.
//
// The reverse direction never reconstructs the tree from the projection. It compares the
// edited doc to the tree it was projected from and emits the smallest ops that explain the
// difference, so anything the projection does not model — unknown nodes, lexical form,
// node identities — is carried by the tree rather than round-tripped through the editor.
// A shape it cannot explain is rejected outright (task 6.3): a silently-dropped edit is
// worse than a refused one, because only the refusal can be reconciled.

import { Node as PMNode } from 'prosemirror-model';
import {
  findNode,
  type OoxmlNode,
  type OoxmlPart,
  type OoxmlProperty,
  type TreeDocOp,
} from '@docx-editor.dev/engine-core';
import { runPropsOf, treeSchema } from './tree-schema.ts';

export type TreeBindingRejection =
  | 'paragraph-count-unexplained'
  | 'paragraph-reordered'
  | 'unknown-paragraph-id'
  | 'unknown-content-moved'
  | 'unsupported-node'
  | 'split-not-clean'
  | 'join-not-clean';

export type MapResult =
  | { readonly ok: true; readonly ops: readonly TreeDocOp[] }
  | { readonly ok: false; readonly reason: TreeBindingRejection; readonly detail?: string };

/** One projected inline token, in paragraph order. */
type Token =
  | { readonly kind: 'text'; readonly text: string; readonly props: readonly OoxmlProperty[] }
  | { readonly kind: 'tab' }
  | { readonly kind: 'hardBreak' }
  | { readonly kind: 'unknown'; readonly nodeId: string };

function propsEqual(a: readonly OoxmlProperty[], b: readonly OoxmlProperty[]): boolean {
  return JSON.stringify(normalizeProps(a)) === JSON.stringify(normalizeProps(b));
}

/** Sorted by name so property ORDER inside `w:rPr` is not treated as a difference. */
function normalizeProps(props: readonly OoxmlProperty[]): OoxmlProperty[] {
  return [...props]
    .map((property) => ({
      localName: property.localName,
      attributes: Object.fromEntries(
        Object.entries(property.attributes ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))
      ),
    }))
    .sort((a, b) => (a.localName < b.localName ? -1 : 1));
}

/** Accepted `w:rPr` / `w:pPr` children of a container, as authored. */
function propertiesOf(container: OoxmlNode | undefined): OoxmlProperty[] {
  if (!container || container.kind === 'textValue') return [];
  const props: OoxmlProperty[] = [];
  for (const child of container.children) {
    if (child.kind === 'textValue') continue;
    const attributes: Record<string, string> = {};
    for (const attribute of child.attributes) attributes[attribute.localName] = attribute.value;
    props.push(
      Object.keys(attributes).length > 0
        ? { localName: child.localName, attributes }
        : { localName: child.localName }
    );
  }
  return props;
}

/** Flatten a tree paragraph into projected tokens. */
function tokensOfParagraph(paragraph: OoxmlNode): Token[] {
  if (paragraph.kind === 'textValue') return [];
  const tokens: Token[] = [];
  for (const child of paragraph.children) {
    if (child.kind === 'paragraphProperties') continue;
    if (child.kind !== 'run') {
      // Paragraph-level unknown content keeps a position in the inline sequence.
      tokens.push({ kind: 'unknown', nodeId: child.id });
      continue;
    }
    const rPr = child.children.find((grand) => grand.kind === 'runProperties');
    const props = propertiesOf(rPr);
    for (const grand of child.children) {
      if (grand.kind === 'runProperties') continue;
      if (grand.kind === 'tab') {
        tokens.push({ kind: 'tab' });
        continue;
      }
      if (grand.kind === 'hardBreak') {
        tokens.push({ kind: 'hardBreak' });
        continue;
      }
      if (grand.kind === 'text') {
        let text = '';
        for (const value of grand.children) {
          if (value.kind === 'textValue') text += value.value;
        }
        if (text.length > 0) tokens.push({ kind: 'text', text, props });
        continue;
      }
      tokens.push({ kind: 'unknown', nodeId: grand.id });
    }
  }
  return tokens;
}

/** Body paragraphs of a part, in document order. */
export function bodyParagraphs(part: OoxmlPart): OoxmlNode[] {
  const paragraphs: OoxmlNode[] = [];
  const walk = (node: OoxmlNode): void => {
    if (node.kind === 'textValue') return;
    if (node.kind === 'body') {
      for (const child of node.children) {
        if (child.kind === 'paragraph') paragraphs.push(child);
      }
      return;
    }
    for (const child of node.children) walk(child);
  };
  walk(part.root);
  return paragraphs;
}

/** Project one tree revision into a ProseMirror doc (task 6.1). */
export function treeToDoc(part: OoxmlPart): PMNode {
  const paragraphs = bodyParagraphs(part).map((paragraph) => {
    const pPr =
      paragraph.kind === 'textValue'
        ? undefined
        : paragraph.children.find((child) => child.kind === 'paragraphProperties');
    const inline = tokensOfParagraph(paragraph).map((token) => {
      switch (token.kind) {
        case 'text':
          return treeSchema.text(
            token.text,
            token.props.length > 0 ? [treeSchema.marks.runProps.create({ props: token.props })] : []
          );
        case 'tab':
          return treeSchema.node('tab');
        case 'hardBreak':
          return treeSchema.node('hardBreak');
        default:
          return treeSchema.node('unknownInline', { nodeId: token.nodeId, label: '' });
      }
    });
    return treeSchema.node('paragraph', { nodeId: paragraph.id, props: propertiesOf(pPr) }, inline);
  });
  return treeSchema.node(
    'doc',
    null,
    paragraphs.length > 0 ? paragraphs : [treeSchema.node('paragraph')]
  );
}

/** Read a PM paragraph back into the same token shape, for comparison. */
function tokensOfNode(node: PMNode): Token[] {
  const tokens: Token[] = [];
  node.forEach((child) => {
    if (child.isText && child.text) {
      tokens.push({ kind: 'text', text: child.text, props: runPropsOf(child) });
      return;
    }
    if (child.type.name === 'tab') tokens.push({ kind: 'tab' });
    else if (child.type.name === 'hardBreak') tokens.push({ kind: 'hardBreak' });
    else if (child.type.name === 'unknownInline') {
      tokens.push({ kind: 'unknown', nodeId: String(child.attrs.nodeId ?? '') });
    }
  });
  return tokens;
}

/** Plain text of a token list, as the ops address it. */
function textOf(tokens: readonly Token[]): string {
  let text = '';
  for (const token of tokens) {
    if (token.kind === 'text') text += token.text;
    else if (token.kind === 'tab') text += '\t';
    else if (token.kind === 'hardBreak') text += '\n';
    // An unknown token occupies no text offset: it is not addressable content.
  }
  return text;
}

/**
 * Where each unknown node sits, as `id@textOffset`.
 *
 * The id sequence alone is not enough: moving an unknown node from after the text to
 * before it leaves the same ids in the same order, so only its OFFSET reveals the move.
 */
function unknownPositions(tokens: readonly Token[]): string[] {
  const positions: string[] = [];
  let offset = 0;
  for (const token of tokens) {
    if (token.kind === 'text') offset += token.text.length;
    else if (token.kind === 'tab' || token.kind === 'hardBreak') offset += 1;
    else positions.push(`${token.nodeId}@${offset}`);
  }
  return positions;
}

/** Longest common prefix / suffix, so a one-character edit maps to a one-character op. */
function diffRange(
  before: string,
  after: string
): { start: number; endBefore: number; endAfter: number } | null {
  if (before === after) return null;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  return { start, endBefore, endAfter };
}

/** The accepted run properties in force at each text offset. */
function propsByOffset(tokens: readonly Token[]): (readonly OoxmlProperty[])[] {
  const at: (readonly OoxmlProperty[])[] = [];
  for (const token of tokens) {
    if (token.kind === 'text') {
      for (let i = 0; i < token.text.length; i += 1) at.push(token.props);
    } else if (token.kind === 'tab' || token.kind === 'hardBreak') {
      // A tab or break carries its run's properties too, but the projection does not model
      // them, so it inherits whatever the surrounding text has rather than claiming none.
      at.push(at[at.length - 1] ?? []);
    }
  }
  return at;
}

function paragraphOps(
  paragraphId: string,
  before: readonly Token[],
  after: readonly Token[],
  beforeProps: readonly OoxmlProperty[],
  afterProps: readonly OoxmlProperty[]
): MapResult {
  const ops: TreeDocOp[] = [];

  // Unknown content must survive an edit unchanged and in place. A projection that lost or
  // reordered it means the editor mutated something it does not model.
  const beforeUnknown = unknownPositions(before);
  const afterUnknown = unknownPositions(after);
  if (JSON.stringify(beforeUnknown) !== JSON.stringify(afterUnknown)) {
    return { ok: false, reason: 'unknown-content-moved', detail: paragraphId };
  }

  if (!propsEqual(beforeProps, afterProps)) {
    ops.push({ op: 'setParagraphProperties', paragraphId, properties: normalizeProps(afterProps) });
  }

  const beforeText = textOf(before);
  const afterText = textOf(after);
  const range = diffRange(beforeText, afterText);
  if (range) {
    // Delete first, then insert at the same offset: two ops that compose to a replacement
    // without needing a replace primitive.
    if (range.endBefore > range.start) {
      ops.push({ op: 'deleteText', paragraphId, start: range.start, end: range.endBefore });
    }
    if (range.endAfter > range.start) {
      const inserted = afterText.slice(range.start, range.endAfter);
      // A tab or newline inside the inserted text is a CONTENT TOKEN, not a character, so
      // it maps to its own op rather than being written into a `w:t`.
      let cursor = range.start;
      let buffer = '';
      const flush = (): void => {
        if (buffer.length === 0) return;
        ops.push({ op: 'insertText', paragraphId, offset: cursor, text: buffer });
        cursor += buffer.length;
        buffer = '';
      };
      for (const character of inserted) {
        if (character === '\t') {
          flush();
          ops.push({ op: 'insertTab', paragraphId, offset: cursor });
          cursor += 1;
        } else if (character === '\n') {
          flush();
          ops.push({ op: 'insertHardBreak', paragraphId, offset: cursor });
          cursor += 1;
        } else buffer += character;
      }
      flush();
    }
  }

  // Formatting is diffed POINTWISE over text offsets, then coalesced into maximal ranges.
  //
  // Comparing span-to-span by exact bounds does not work: bolding the first half of a run
  // re-segments one span into two, so the untouched second half has no counterpart and
  // reads as a change, emitting a redundant `setRunProperties []` over text whose
  // properties never moved. Offsets are stable across that re-segmentation; span bounds
  // are not.
  if (!range) {
    const beforeAt = propsByOffset(before);
    const afterAt = propsByOffset(after);
    let index = 0;
    while (index < afterAt.length) {
      if (propsEqual(beforeAt[index] ?? [], afterAt[index]!)) {
        index += 1;
        continue;
      }
      const start = index;
      const target = afterAt[index]!;
      while (
        index < afterAt.length &&
        propsEqual(afterAt[index]!, target) &&
        !propsEqual(beforeAt[index] ?? [], afterAt[index]!)
      ) {
        index += 1;
      }
      ops.push({
        op: 'setRunProperties',
        paragraphId,
        start,
        end: index,
        properties: normalizeProps(target),
      });
    }
  }

  return { ok: true, ops };
}

/**
 * Map an edited ProseMirror doc back into typed tree ops (task 6.2), or refuse (6.3).
 *
 * Handles a paragraph count delta of 0 (in-place edits), +1 (a clean split) and -1 (a clean
 * join). Anything else — a reorder, a multi-paragraph paste, a structural change combined
 * with an edit elsewhere — is refused rather than approximated, because the approximation
 * is what silently loses content.
 */
export function docToTreeOps(part: OoxmlPart, doc: PMNode): MapResult {
  const treeParagraphs = bodyParagraphs(part);
  const docParagraphs: PMNode[] = [];
  doc.forEach((node) => {
    if (node.type.name === 'paragraph') docParagraphs.push(node);
  });
  if (docParagraphs.length !== doc.childCount) {
    return { ok: false, reason: 'unsupported-node' };
  }

  const delta = docParagraphs.length - treeParagraphs.length;

  if (delta === 0) {
    const ops: TreeDocOp[] = [];
    for (const [index, node] of docParagraphs.entries()) {
      const paragraph = treeParagraphs[index]!;
      if (node.attrs.nodeId !== paragraph.id) {
        return { ok: false, reason: 'paragraph-reordered', detail: String(node.attrs.nodeId) };
      }
      const result = paragraphOps(
        paragraph.id,
        tokensOfParagraph(paragraph),
        tokensOfNode(node),
        propertiesOf(
          paragraph.kind === 'textValue'
            ? undefined
            : paragraph.children.find((child) => child.kind === 'paragraphProperties')
        ),
        (node.attrs.props as OoxmlProperty[]) ?? []
      );
      if (!result.ok) return result;
      ops.push(...result.ops);
    }
    return { ok: true, ops };
  }

  if (delta === 1) return mapSplit(part, treeParagraphs, docParagraphs);
  if (delta === -1) return mapJoin(part, treeParagraphs, docParagraphs);
  return { ok: false, reason: 'paragraph-count-unexplained', detail: String(delta) };
}

/** Exactly one paragraph divided in two, with everything else untouched. */
function mapSplit(
  part: OoxmlPart,
  treeParagraphs: readonly OoxmlNode[],
  docParagraphs: readonly PMNode[]
): MapResult {
  let index = 0;
  while (
    index < treeParagraphs.length &&
    docParagraphs[index]?.attrs.nodeId === treeParagraphs[index]!.id &&
    textOf(tokensOfNode(docParagraphs[index]!)) ===
      textOf(tokensOfParagraph(treeParagraphs[index]!))
  ) {
    index += 1;
  }
  const source = treeParagraphs[index];
  const head = docParagraphs[index];
  const tail = docParagraphs[index + 1];
  if (!source || !head || !tail) return { ok: false, reason: 'split-not-clean' };
  if (head.attrs.nodeId !== source.id) return { ok: false, reason: 'split-not-clean' };
  // ProseMirror's splitBlock copies the source attrs onto the tail, so the tail carries
  // either the source id or none. Any OTHER id would be forging an existing identity.
  const tailId = tail.attrs.nodeId;
  if (tailId !== null && tailId !== source.id) return { ok: false, reason: 'split-not-clean' };

  const sourceText = textOf(tokensOfParagraph(source));
  if (textOf(tokensOfNode(head)) + textOf(tokensOfNode(tail)) !== sourceText) {
    return { ok: false, reason: 'split-not-clean' };
  }
  // Every paragraph after the split must be untouched, or a structural change is riding
  // along with an edit and the two cannot be told apart afterwards.
  for (let i = index + 1; i < treeParagraphs.length; i += 1) {
    const node = docParagraphs[i + 1];
    const paragraph = treeParagraphs[i]!;
    if (!node || node.attrs.nodeId !== paragraph.id)
      return { ok: false, reason: 'split-not-clean' };
    if (textOf(tokensOfNode(node)) !== textOf(tokensOfParagraph(paragraph))) {
      return { ok: false, reason: 'split-not-clean' };
    }
  }
  void part;
  return {
    ok: true,
    ops: [
      { op: 'splitParagraph', paragraphId: source.id, offset: textOf(tokensOfNode(head)).length },
    ],
  };
}

/** Exactly two adjacent paragraphs merged, with everything else untouched. */
function mapJoin(
  part: OoxmlPart,
  treeParagraphs: readonly OoxmlNode[],
  docParagraphs: readonly PMNode[]
): MapResult {
  let index = 0;
  while (
    index < docParagraphs.length &&
    docParagraphs[index]?.attrs.nodeId === treeParagraphs[index]!.id &&
    textOf(tokensOfNode(docParagraphs[index]!)) ===
      textOf(tokensOfParagraph(treeParagraphs[index]!))
  ) {
    index += 1;
  }
  const first = treeParagraphs[index];
  const second = treeParagraphs[index + 1];
  const survivor = docParagraphs[index];
  if (!first || !second || !survivor) return { ok: false, reason: 'join-not-clean' };
  if (survivor.attrs.nodeId !== first.id) return { ok: false, reason: 'join-not-clean' };
  const expected = textOf(tokensOfParagraph(first)) + textOf(tokensOfParagraph(second));
  if (textOf(tokensOfNode(survivor)) !== expected) return { ok: false, reason: 'join-not-clean' };
  for (let i = index + 2; i < treeParagraphs.length; i += 1) {
    const node = docParagraphs[i - 1];
    const paragraph = treeParagraphs[i]!;
    if (!node || node.attrs.nodeId !== paragraph.id) return { ok: false, reason: 'join-not-clean' };
  }
  void part;
  return { ok: true, ops: [{ op: 'joinParagraphs', firstId: first.id, secondId: second.id }] };
}

/** Whether a tree node id is still present, for reconciliation checks. */
export function partHasNode(part: OoxmlPart, nodeId: string): boolean {
  return findNode(part, nodeId) !== null;
}
