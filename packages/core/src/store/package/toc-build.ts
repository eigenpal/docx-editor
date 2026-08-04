// Build TOC result paragraphs and ensure heading bookmarks.

import { WML_NAMESPACE_URI, XML_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlNode, OoxmlPart } from './ooxml-tree.ts';
import { buildBookmarkIndex } from './bookmarks.ts';
/** Outline heading shape consumed by TOC planning (mirrors DocumentOutlineEntry). */
export interface TocOutlineHeading {
  readonly text: string;
  readonly level: number;
  readonly blockId: string;
}
import type { TocInstruction } from './toc-instruction.ts';
import { TOC_MAX_BOOKMARKS_PER_REFRESH, TOC_MAX_ENTRIES } from './toc-instruction.ts';

/** Left-indent step between TOC levels, in twips (matches `scripts/demo-doc/toc-block.xml`). */
export const TOC_LEVEL_INDENT_TWIPS = 240;

/** Bounded left-indent twips for a TOC entry level (0-based heading depth). */
export function tocLeftIndentTwips(level: number): number {
  if (!Number.isFinite(level)) return 0;
  const bounded = Math.max(0, Math.min(8, Math.trunc(level)));
  return bounded * TOC_LEVEL_INDENT_TWIPS;
}

export interface TocEntryPlan {
  readonly level: number;
  readonly text: string;
  readonly headingParagraphId: string;
  readonly bookmarkName: string;
  readonly pageNumberText: string;
}

function wAttr(localName: string, value: string) {
  return {
    kind: 'genericExtension' as const,
    namespaceUri: WML_NAMESPACE_URI,
    localName,
    prefix: 'w',
    value,
  };
}

function textNode(mint: () => string, text: string): OoxmlNode {
  return {
    id: mint(),
    kind: 'text',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 't',
    prefix: 'w',
    namespaceBindings: [],
    attributes: /^\s|\s$/.test(text)
      ? [
          {
            kind: 'xmlSpace',
            namespaceUri: XML_NAMESPACE_URI,
            localName: 'space',
            prefix: 'xml',
            value: 'preserve',
          },
        ]
      : [],
    children: [{ id: mint(), kind: 'textValue', value: text }],
  } as unknown as OoxmlNode;
}

function runWithText(mint: () => string, text: string): OoxmlNode {
  return {
    id: mint(),
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [textNode(mint, text)],
  } as unknown as OoxmlNode;
}

function ptabRun(mint: () => string): OoxmlNode {
  return {
    id: mint(),
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [
      {
        id: mint(),
        kind: 'generic',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'ptab',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [
          wAttr('alignment', 'right'),
          wAttr('relativeTo', 'margin'),
          wAttr('leader', 'dot'),
        ],
        children: [],
      },
    ],
  } as unknown as OoxmlNode;
}

function fieldChar(mint: () => string, type: 'begin' | 'separate' | 'end'): OoxmlNode {
  return {
    id: mint(),
    kind: 'fldChar',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'fldChar',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [wAttr('fldCharType', type)],
    children: [],
  } as unknown as OoxmlNode;
}

function instructionText(mint: () => string, instruction: string): OoxmlNode {
  return {
    id: mint(),
    kind: 'instrText',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'instrText',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [
      {
        kind: 'xmlSpace',
        namespaceUri: XML_NAMESPACE_URI,
        localName: 'space',
        prefix: 'xml',
        value: 'preserve',
      },
    ],
    children: [{ id: mint(), kind: 'textValue', value: ` ${instruction} ` }],
  } as unknown as OoxmlNode;
}

function runWithChildren(mint: () => string, children: readonly OoxmlNode[]): OoxmlNode {
  return {
    id: mint(),
    kind: 'run',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'r',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [...children],
  } as unknown as OoxmlNode;
}

function paragraphWithChildren(mint: () => string, children: readonly OoxmlNode[]): OoxmlNode {
  return {
    id: mint(),
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [...children],
  } as unknown as OoxmlNode;
}

function indentNode(mint: () => string, leftTwips: number): OoxmlNode {
  return {
    id: mint(),
    kind: 'generic',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'ind',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [wAttr('left', String(leftTwips))],
    children: [],
  } as unknown as OoxmlNode;
}

function hasIndentChild(properties: OoxmlNode): boolean {
  if (properties.kind === 'textValue') return false;
  return properties.children.some(
    (child) => child.kind !== 'textValue' && child.localName === 'ind'
  );
}

function insertIndentAfterStyle(properties: OoxmlNode, indent: OoxmlNode): OoxmlNode {
  if (properties.kind === 'textValue') return properties;
  const children = [...properties.children];
  const styleIndex = children.findIndex(
    (child) => child.kind !== 'textValue' && child.localName === 'pStyle'
  );
  if (styleIndex >= 0) {
    children.splice(styleIndex + 1, 0, indent);
  } else {
    children.push(indent);
  }
  return { ...properties, children } as OoxmlNode;
}

/** Add a default level indent when a preserved template omits direct `w:ind`. */
function ensureTocIndent(properties: OoxmlNode, mint: () => string, level: number): OoxmlNode {
  if (hasIndentChild(properties)) return properties;
  const left = tocLeftIndentTwips(level);
  if (left === 0) return properties;
  return insertIndentAfterStyle(properties, indentNode(mint, left));
}

function paragraphProperties(mint: () => string, styleId: string, level: number): OoxmlNode {
  const children: OoxmlNode[] = [
    {
      id: mint(),
      kind: 'generic',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'pStyle',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [wAttr('val', styleId)],
      children: [],
    } as unknown as OoxmlNode,
  ];
  const left = tocLeftIndentTwips(level);
  if (left > 0) {
    children.push(indentNode(mint, left));
  }
  return {
    id: mint(),
    kind: 'paragraphProperties',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'pPr',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children,
  } as unknown as OoxmlNode;
}

function withFreshIds(node: OoxmlNode, mint: () => string): OoxmlNode {
  if (node.kind === 'textValue') return { ...node, id: mint() };
  return {
    ...node,
    id: mint(),
    children: node.children.map((child) => withFreshIds(child, mint)),
  } as OoxmlNode;
}

/** Build one TOC entry paragraph node. */
export function buildTocEntryParagraph(
  mint: () => string,
  entry: TocEntryPlan,
  instruction: TocInstruction,
  paragraphPropertiesTemplate?: OoxmlNode
): OoxmlNode {
  const styleId = `TOC${Math.min(entry.level + 1, 9)}`;
  const runs: OoxmlNode[] = [runWithText(mint, entry.text)];
  if (!instruction.omitPageNumbers) {
    runs.push(ptabRun(mint));
    runs.push(runWithText(mint, entry.pageNumberText));
  }

  const content: OoxmlNode[] = instruction.hyperlink
    ? [
        {
          id: mint(),
          kind: 'hyperlink',
          namespaceUri: WML_NAMESPACE_URI,
          localName: 'hyperlink',
          prefix: 'w',
          namespaceBindings: [],
          attributes: [wAttr('anchor', entry.bookmarkName)],
          children: runs,
        } as unknown as OoxmlNode,
      ]
    : runs;

  const properties = paragraphPropertiesTemplate
    ? ensureTocIndent(withFreshIds(paragraphPropertiesTemplate, mint), mint, entry.level)
    : paragraphProperties(mint, styleId, entry.level);

  return {
    id: mint(),
    kind: 'paragraph',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'p',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [properties, ...content],
  } as unknown as OoxmlNode;
}

/** Build an SDT-wrapped complex TOC field with an already planned cached result. */
export function buildTocContentControl(
  mint: () => string,
  entries: readonly TocEntryPlan[],
  instruction: TocInstruction,
  alias: string
): OoxmlNode {
  const begin = paragraphWithChildren(mint, [
    runWithChildren(mint, [
      fieldChar(mint, 'begin'),
      instructionText(mint, instruction.raw),
      fieldChar(mint, 'separate'),
    ]),
  ]);
  const end = paragraphWithChildren(mint, [runWithChildren(mint, [fieldChar(mint, 'end')])]);
  const properties: OoxmlNode = {
    id: mint(),
    kind: 'contentControlProperties',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'sdtPr',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [
      {
        id: mint(),
        kind: 'generic',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'alias',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [wAttr('val', alias)],
        children: [],
      } as unknown as OoxmlNode,
      {
        id: mint(),
        kind: 'generic',
        namespaceUri: WML_NAMESPACE_URI,
        localName: 'docPartObj',
        prefix: 'w',
        namespaceBindings: [],
        attributes: [],
        children: [
          {
            id: mint(),
            kind: 'generic',
            namespaceUri: WML_NAMESPACE_URI,
            localName: 'docPartGallery',
            prefix: 'w',
            namespaceBindings: [],
            attributes: [wAttr('val', 'Table of Contents')],
            children: [],
          } as unknown as OoxmlNode,
          {
            id: mint(),
            kind: 'generic',
            namespaceUri: WML_NAMESPACE_URI,
            localName: 'docPartUnique',
            prefix: 'w',
            namespaceBindings: [],
            attributes: [],
            children: [],
          } as unknown as OoxmlNode,
        ],
      } as unknown as OoxmlNode,
    ],
  } as unknown as OoxmlNode;
  const content: OoxmlNode = {
    id: mint(),
    kind: 'contentControlContent',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'sdtContent',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [
      begin,
      ...entries.map((entry) => buildTocEntryParagraph(mint, entry, instruction)),
      end,
    ],
  } as unknown as OoxmlNode;
  return {
    id: mint(),
    kind: 'contentControl',
    namespaceUri: WML_NAMESPACE_URI,
    localName: 'sdt',
    prefix: 'w',
    namespaceBindings: [],
    attributes: [],
    children: [properties, content],
  } as unknown as OoxmlNode;
}

function bookmarkNameOk(name: string): boolean {
  return name.length > 0 && name.length <= 40 && !/[\u0000-\u001F\u007F-\u009F]/.test(name);
}

/**
 * Plan TOC entries from the outline and existing bookmarks.
 */
export function planTocEntries(
  part: OoxmlPart,
  outline: readonly TocOutlineHeading[],
  instruction: TocInstruction,
  pageNumberByParagraphId: ReadonlyMap<string, string>,
  excludeParagraphIds: ReadonlySet<string>
): {
  readonly entries: readonly TocEntryPlan[];
  readonly bookmarksToCreate: readonly { paragraphId: string; name: string }[];
} {
  const index = buildBookmarkIndex(part);
  const nameByParagraph = new Map<string, string>();
  for (const [name, anchor] of index) {
    if (name.startsWith('_Toc') && !nameByParagraph.has(anchor.paragraphId)) {
      nameByParagraph.set(anchor.paragraphId, name);
    }
  }

  const entries: TocEntryPlan[] = [];
  const bookmarksToCreate: { paragraphId: string; name: string }[] = [];
  let bookmarkAlloc = 0;
  let nextTocId = 1_600_000_000 + (index.size % 10_000);

  for (const heading of outline) {
    if (entries.length >= TOC_MAX_ENTRIES) break;
    if (excludeParagraphIds.has(heading.blockId)) continue;
    const oneBased = heading.level + 1;
    if (oneBased < instruction.outlineStart || oneBased > instruction.outlineEnd) continue;

    let bookmarkName = nameByParagraph.get(heading.blockId);
    if (!bookmarkName && instruction.hyperlink) {
      if (bookmarkAlloc >= TOC_MAX_BOOKMARKS_PER_REFRESH) continue;
      bookmarkName = `_Toc${nextTocId}`;
      nextTocId += 1;
      if (!bookmarkNameOk(bookmarkName)) continue;
      bookmarksToCreate.push({ paragraphId: heading.blockId, name: bookmarkName });
      bookmarkAlloc += 1;
      nameByParagraph.set(heading.blockId, bookmarkName);
    }
    if (!bookmarkName) {
      bookmarkName = `_Toc${heading.blockId.replace(/[^A-Za-z0-9]/g, '').slice(-12) || '0'}`;
    }

    entries.push({
      level: heading.level,
      // Word flattens manual line/tab breaks from a heading into spaces in its TOC cache.
      // Carrying them verbatim makes a short title wrap even when the TOC row has ample room.
      text: heading.text
        .replace(/[\t\n\r]+/g, ' ')
        .replace(/ {2,}/g, ' ')
        .trim(),
      headingParagraphId: heading.blockId,
      bookmarkName,
      pageNumberText: pageNumberByParagraphId.get(heading.blockId) ?? '1',
    });
  }

  return { entries, bookmarksToCreate };
}

/** Create bookmarkStart/End pair nodes for insertion at the start of a paragraph. */
export function bookmarkPairNodes(
  mint: () => string,
  name: string,
  id: string
): { readonly start: OoxmlNode; readonly end: OoxmlNode } {
  return {
    start: {
      id: mint(),
      kind: 'bookmarkStart',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'bookmarkStart',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [wAttr('id', id), wAttr('name', name)],
      children: [],
    } as unknown as OoxmlNode,
    end: {
      id: mint(),
      kind: 'bookmarkEnd',
      namespaceUri: WML_NAMESPACE_URI,
      localName: 'bookmarkEnd',
      prefix: 'w',
      namespaceBindings: [],
      attributes: [wAttr('id', id)],
      children: [],
    } as unknown as OoxmlNode,
  };
}
