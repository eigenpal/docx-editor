// Font needs synthesized by layout, shared by editor and export resolution.
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { WML_NAMESPACE_URI } from '../store/package/ooxml-shared.ts';
import { validFontFamily } from '../store/package/run-defaults.ts';
import { collectFlowBlocks } from '../store/package/content-control-walk.ts';
import { buildNumberingIndex } from './numbering-index.ts';
import { buildStyleCascadeTable } from './style-cascade.ts';
import { resolveStoryListItems } from './list-resolve.ts';
import { hostedTextboxContents, textboxStoryListItems } from './textbox-story-layout.ts';
import { parseSymbolInstruction } from './field-symbol.ts';
import {
  createFieldParseState,
  effectiveFieldInstruction,
  onFldCharBegin,
  onFldCharEnd,
  onFldCharSeparate,
  onInstrText,
  resetFieldParseState,
} from './field-instruction.ts';

function attributeValue(node: OoxmlElement, localName: string): string | undefined {
  return node.attributes.find((attribute) => attribute.localName === localName)?.value;
}

/** Valid SYMBOL field faces over body, furniture, notes, tables, and text boxes. */
export function symbolFieldFontFamilies(roots: readonly OoxmlElement[]): readonly string[] {
  const families = new Map<string, string>();
  const add = (candidate: string | null | undefined): void => {
    const family = validFontFamily(candidate ?? undefined);
    if (family !== null && !families.has(family.toLowerCase()))
      families.set(family.toLowerCase(), family);
  };
  for (const root of roots) {
    const stack: OoxmlElement[] = [root];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.namespaceUri === WML_NAMESPACE_URI) {
        if (node.localName === 'fldSimple')
          add(parseSymbolInstruction(attributeValue(node, 'instr') ?? '')?.font);
        if (node.localName === 'p') for (const family of complexSymbolFieldFonts(node)) add(family);
      }
      for (let i = node.children.length - 1; i >= 0; i--) {
        const child = node.children[i]!;
        if (child.kind !== 'textValue') stack.push(child as OoxmlElement);
      }
    }
  }
  return [...families.values()];
}

export function complexSymbolFieldFonts(paragraph: OoxmlElement): readonly string[] {
  const families: string[] = [];
  const state = createFieldParseState();
  const stack: OoxmlElement[] = [];
  for (let index = paragraph.children.length - 1; index >= 0; index -= 1) {
    const child = paragraph.children[index]!;
    if (child.kind !== 'textValue') stack.push(child as OoxmlElement);
  }
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'p') continue;
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldChar') {
      const kind = attributeValue(node, 'fldCharType');
      if (kind === 'begin') onFldCharBegin(state);
      else if (kind === 'separate') {
        if (state.nesting === 1) noteEffectiveSymbolFont(state, families);
        onFldCharSeparate(state);
      } else if (kind === 'end') {
        if (state.nesting === 1) noteEffectiveSymbolFont(state, families);
        onFldCharEnd(state);
      }
      continue;
    }
    if (
      node.namespaceUri === WML_NAMESPACE_URI &&
      (node.localName === 'instrText' || node.localName === 'delInstrText')
    ) {
      onInstrText(state, boundedTextContent(node), node.localName === 'delInstrText');
      continue;
    }
    if (node.namespaceUri === WML_NAMESPACE_URI && node.localName === 'fldSimple') {
      const spec = parseSymbolInstruction(attributeValue(node, 'instr') ?? '');
      if (spec?.font) families.push(spec.font);
    }
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      const child = node.children[index]!;
      if (child.kind !== 'textValue') stack.push(child as OoxmlElement);
    }
  }
  resetFieldParseState(state);
  return families;
}

function noteEffectiveSymbolFont(
  state: ReturnType<typeof createFieldParseState>,
  families: string[]
): void {
  const effective = effectiveFieldInstruction(state);
  if (effective.overflow) return;
  const spec = parseSymbolInstruction(effective.instruction);
  if (spec?.font) families.push(spec.font);
}

function boundedTextContent(root: OoxmlElement): string {
  let text = '';
  const stack = [...root.children].reverse();
  while (stack.length > 0 && text.length <= 256) {
    const node = stack.pop()!;
    if (node.kind === 'textValue') text += node.value;
    else {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]!);
      }
    }
  }
  return text;
}

export function usedNumberingFontFamilies(
  storyRoots: readonly OoxmlElement[],
  numberingRoot: OoxmlElement | null,
  stylesRoot: OoxmlElement | null,
  theme: {
    readonly major: string | null;
    readonly minor: string | null;
    readonly majorEastAsia: string | null;
    readonly minorEastAsia: string | null;
  }
): readonly string[] {
  if (!numberingRoot) return [];
  const numbering = buildNumberingIndex(numberingRoot);
  const styles = buildStyleCascadeTable(stylesRoot, theme);
  const byFold = new Map<string, string>();
  for (const root of storyRoots) {
    for (const container of storyFlowContainers(root)) {
      const blocks = collectFlowBlocks(container.children);
      const noteItems = (
        items:
          | ReadonlyMap<
              string,
              {
                readonly markerStyle: {
                  readonly fontFamily?: string | null;
                  readonly fontFamilyEastAsia?: string | null;
                };
              }
            >
          | undefined
      ): void => {
        if (!items) return;
        for (const item of items.values()) {
          for (const candidate of [
            item.markerStyle.fontFamily,
            item.markerStyle.fontFamilyEastAsia,
          ]) {
            const family = validFontFamily(candidate ?? undefined);
            if (family === null) continue;
            const fold = family.toLowerCase();
            if (!byFold.has(fold)) byFold.set(fold, family);
          }
        }
      };
      noteItems(resolveStoryListItems(blocks, numbering, styles));
      for (const block of blocks) {
        const hosted = hostedTextboxContents(block);
        for (const content of hosted.contents) {
          noteItems(textboxStoryListItems(content, numbering, styles));
        }
      }
    }
  }
  return [...byFold.values()].sort((left, right) => left.localeCompare(right));
}

function storyFlowContainers(root: OoxmlElement): readonly OoxmlElement[] {
  if (root.localName === 'document') {
    for (const candidate of root.children) {
      if (candidate.kind !== 'textValue' && candidate.localName === 'body') {
        return [candidate as OoxmlElement];
      }
    }
    return [];
  }
  if (root.localName === 'footnotes' || root.localName === 'endnotes') {
    const notes: OoxmlElement[] = [];
    for (const candidate of root.children) {
      if (
        candidate.kind !== 'textValue' &&
        (candidate.localName === 'footnote' || candidate.localName === 'endnote')
      ) {
        notes.push(candidate as OoxmlElement);
      }
    }
    return notes;
  }
  return [root];
}
